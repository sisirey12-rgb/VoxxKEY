// Anti-abuse layer for /api/activate, /api/validate, /api/status.
//
// HWID alone can't stop key sharing/cracking — it's just a string the
// caller sends, trivially reset (clear localStorage) or spoofed (curl).
// This module adds two things HWID can't fake as easily:
//   1. Per-IP rate limiting + brute-force lockout (same pattern as
//      security.js, applied to the license endpoints).
//   2. Key-sharing detection: flags + alerts when one license_key is hit
//      from many distinct IPs in a short window, regardless of what HWID
//      string comes along with each request.

const { db } = require('../db');
const { sendTelegram } = require('../utils/telegram');

const IP_WINDOW_MINUTES = 15;       // window for general per-IP request rate
const MAX_ATTEMPTS_PER_IP = 20;     // generic abuse cap per IP per window
const MAX_INVALID_PER_IP = 8;       // invalid_key guesses per IP per window -> brute force
const IP_LOCKOUT_MINUTES = 60;

const SHARE_WINDOW_MINUTES = 30;    // window for distinct-IP-per-key check
const SHARE_IP_THRESHOLD = 4;       // >= this many distinct IPs on one key in the window -> alert
const SHARE_ALERT_COOLDOWN_MINUTES = 60; // don't spam Telegram for the same key

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress;
}

async function isIpLocked(ip) {
  await db.execute({ sql: `DELETE FROM lockouts WHERE locked_until <= datetime('now')` });
  const result = await db.execute({
    sql: `SELECT locked_until FROM lockouts WHERE scope_type='license_ip' AND scope_value=? AND locked_until > datetime('now')`,
    args: [ip],
  });
  return result.rows[0] || null;
}

async function lockIp(ip, minutes, reason) {
  await db.execute({
    sql: `
      INSERT OR REPLACE INTO lockouts (scope_type, scope_value, locked_until)
      VALUES ('license_ip', ?, datetime('now', '+' || ? || ' minutes'))
    `,
    args: [ip, minutes],
  });

  await sendTelegram(
`🚫 YORVOXX LICENSE API — IP LOCKED

IP: ${ip}
Reason: ${reason}
Locked for: ${minutes}m`
  );
}

async function logActivity({ license_key = null, hwid = null, ip, userAgent = null, action, success }) {
  await db.execute({
    sql: `
      INSERT INTO license_activity (license_key, hwid, ip, user_agent, action, success, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    args: [license_key, hwid, ip, userAgent, action, success ? 1 : 0],
  });
}

// Run first, before any DB lookup on the license itself. Blocks IPs that
// are already locked out or that are clearly hammering the endpoint.
async function licenseRateLimit(req, res, next) {
  try {
    const ip = getClientIp(req);
    req.clientIp = ip;

    const locked = await isIpLocked(ip);
    if (locked) {
      return res.status(429).json({ success: false, valid: false, reason: 'rate_limited' });
    }

    const windowResult = await db.execute({
      sql: `SELECT COUNT(*) as n FROM license_activity WHERE ip=? AND created_at > datetime('now', '-' || ? || ' minutes')`,
      args: [ip, IP_WINDOW_MINUTES],
    });
    const attempts = Number(windowResult.rows[0]?.n || 0);

    if (attempts >= MAX_ATTEMPTS_PER_IP) {
      await lockIp(ip, IP_LOCKOUT_MINUTES, `${attempts} license API requests in ${IP_WINDOW_MINUTES}m`);
      return res.status(429).json({ success: false, valid: false, reason: 'rate_limited' });
    }

    next();
  } catch (err) {
    // Fail open on middleware errors so a DB hiccup doesn't take down
    // legitimate license checks — but log it loudly.
    console.error('licenseRateLimit error:', err);
    next();
  }
}

// Call after logging an invalid_key hit. Locks the IP out once it crosses
// the brute-force threshold (someone guessing keys).
async function recordInvalidKeyAttempt(ip) {
  const windowResult = await db.execute({
    sql: `
      SELECT COUNT(*) as n FROM license_activity
      WHERE ip=? AND action='invalid_key' AND created_at > datetime('now', '-' || ? || ' minutes')
    `,
    args: [ip, IP_WINDOW_MINUTES],
  });
  const fails = Number(windowResult.rows[0]?.n || 0);

  if (fails >= MAX_INVALID_PER_IP) {
    await lockIp(ip, IP_LOCKOUT_MINUTES, `${fails} invalid license key attempts in ${IP_WINDOW_MINUTES}m (key brute-force)`);
  }
}

const lastShareAlert = new Map(); // license_key -> timestamp ms, in-memory cooldown

// Checks how many distinct IPs have hit this key recently. This is the
// check that actually catches sharing: someone can reset their HWID
// endlessly, but they can't fake "this key is being used from 6 countries
// at once" away.
async function checkKeySharing(license_key, ip) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT ip FROM license_activity
      WHERE license_key=? AND created_at > datetime('now', '-' || ? || ' minutes')
    `,
    args: [license_key, SHARE_WINDOW_MINUTES],
  });
  const distinctIps = new Set(result.rows.map(r => r.ip));
  distinctIps.add(ip);

  if (distinctIps.size < SHARE_IP_THRESHOLD) return false;

  const now = Date.now();
  const last = lastShareAlert.get(license_key) || 0;
  if (now - last < SHARE_ALERT_COOLDOWN_MINUTES * 60000) return true; // already alerted recently

  lastShareAlert.set(license_key, now);

  await db.execute({
    sql: `UPDATE licenses SET flagged = 1 WHERE license_key = ?`,
    args: [license_key],
  });

  await sendTelegram(
`⚠️ YORVOXX LICENSE SHARING SUSPECTED

Key: ${license_key}
Distinct IPs (last ${SHARE_WINDOW_MINUTES}m): ${distinctIps.size}
IPs: ${[...distinctIps].join(', ')}

Key has been flagged in the DB. Review in admin and revoke if confirmed.`
  );

  return true;
}

module.exports = {
  getClientIp,
  licenseRateLimit,
  recordInvalidKeyAttempt,
  logActivity,
  checkKeySharing,
};
