const express = require('express');
const { db } = require('../db');
const { computeStatus, daysLeft, nowISO } = require('../helpers');
const {
  licenseRateLimit,
  recordInvalidKeyAttempt,
  logActivity,
  checkKeySharing,
  getClientIp,
} = require('../middleware/licenseSecurity');
const { verifyRequestSignature } = require('../middleware/requestSignature');

const router = express.Router();

// Signature check runs first — it's cheap (no DB) and rejects forged
// requests before they can burn rate-limit budget or touch the database.
router.use(verifyRequestSignature);

// Rate limiting / IP lockout applies to every route in this file.
router.use(licenseRateLimit);

// Called once from the app's activation screen when the user enters a key.
router.post('/activate', async (req, res) => {
  console.log("========== ACTIVATE ==========");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);

  const ip = req.clientIp || getClientIp(req);
  const userAgent = req.headers['user-agent'];
  const { license_key, hwid } = req.body || {};

  if (!license_key || !hwid) {
    return res.status(400).json({ success: false, reason: 'license_key and hwid required' });
  }

  const licResult = await db.execute({
    sql: 'SELECT * FROM licenses WHERE license_key = ?',
    args: [license_key],
  });
  const lic = licResult.rows[0];

  if (!lic) {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'invalid_key', success: false });
    await recordInvalidKeyAttempt(ip);
    return res.status(404).json({ success: false, reason: 'invalid_key' });
  }

  const status = computeStatus(lic);
  if (status === 'revoked') {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'activate', success: false });
    return res.status(403).json({ success: false, reason: 'revoked' });
  }
  if (status === 'expired') {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'activate', success: false });
    return res.status(403).json({ success: false, reason: 'expired' });
  }

  const boundResult = await db.execute({
    sql: 'SELECT hwid FROM license_devices WHERE license_key = ?',
    args: [license_key],
  });
  const boundDevices = boundResult.rows;
  const alreadyBound = boundDevices.some(d => d.hwid === hwid);

  // Log + check sharing on every activation attempt (bound or not) — this
  // is what actually catches "same key, many places" even when each
  // caller resets their HWID to look new.
  await logActivity({ license_key, hwid, ip, userAgent, action: 'activate', success: true });
  await checkKeySharing(license_key, ip);

  if (alreadyBound) {
    return res.json({ success: true, expires_at: lic.expires_at, days_left: daysLeft(lic.expires_at) });
  }

  if (boundDevices.length >= lic.max_devices) {
    return res.status(403).json({ success: false, reason: 'device_limit_reached' });
  }

  await db.execute({
    sql: 'INSERT INTO license_devices (license_key, hwid, bound_at) VALUES (?, ?, ?)',
    args: [license_key, hwid, nowISO()],
  });

  // Keep device_hwid column populated with the most recent bind, useful for
  // single-device (max_devices=1) keys and for the admin console display.
  await db.execute({
    sql: 'UPDATE licenses SET device_hwid = ? WHERE license_key = ?',
    args: [hwid, license_key],
  });

  res.json({ success: true, expires_at: lic.expires_at, days_left: daysLeft(lic.expires_at) });
});

// Called on every app launch to confirm the key is still good.
router.post('/validate', async (req, res) => {
  const ip = req.clientIp || getClientIp(req);
  const userAgent = req.headers['user-agent'];
  const { license_key, hwid } = req.body || {};

  if (!license_key || !hwid) {
    return res.json({ valid: false, reason: 'license_key and hwid required' });
  }

  const licResult = await db.execute({
    sql: 'SELECT * FROM licenses WHERE license_key = ?',
    args: [license_key],
  });
  const lic = licResult.rows[0];

  if (!lic) {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'invalid_key', success: false });
    await recordInvalidKeyAttempt(ip);
    return res.json({ valid: false, reason: 'invalid_key' });
  }

  const status = computeStatus(lic);
  if (status === 'revoked') {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'validate', success: false });
    return res.json({ valid: false, reason: 'revoked' });
  }
  if (status === 'expired') {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'validate', success: false });
    return res.json({ valid: false, reason: 'expired' });
  }

  const boundResult = await db.execute({
    sql: 'SELECT 1 FROM license_devices WHERE license_key = ? AND hwid = ?',
    args: [license_key, hwid],
  });

  if (boundResult.rows.length === 0) {
    await logActivity({ license_key, hwid, ip, userAgent, action: 'validate', success: false });
    return res.json({ valid: false, reason: 'device_not_bound' });
  }

  await logActivity({ license_key, hwid, ip, userAgent, action: 'validate', success: true });
  await checkKeySharing(license_key, ip);

  res.json({ valid: true, expires_at: lic.expires_at, days_left: daysLeft(lic.expires_at) });
});

// Public status check — no hwid required, and never reveals any device IDs.
router.post('/status', async (req, res) => {
  const ip = req.clientIp || getClientIp(req);
  const userAgent = req.headers['user-agent'];
  const { license_key } = req.body || {};

  if (!license_key) return res.json({ valid: false, reason: 'license_key_required' });

  const licResult = await db.execute({
    sql: 'SELECT * FROM licenses WHERE license_key = ?',
    args: [license_key],
  });
  const lic = licResult.rows[0];

  if (!lic) {
    await logActivity({ license_key, ip, userAgent, action: 'invalid_key', success: false });
    await recordInvalidKeyAttempt(ip);
    return res.json({ valid: false, reason: 'invalid_key' });
  }

  const status = computeStatus(lic);
  if (status === 'revoked') return res.json({ valid: false, reason: 'revoked' });
  if (status === 'expired') return res.json({ valid: false, reason: 'expired', expires_at: lic.expires_at });

  const boundResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM license_devices WHERE license_key = ?',
    args: [license_key],
  });
  const boundCount = Number(boundResult.rows[0]?.count || 0);

  await logActivity({ license_key, ip, userAgent, action: 'status', success: true });

  res.json({
    valid: true,
    bound: boundCount > 0,
    expires_at: lic.expires_at,
    days_left: daysLeft(lic.expires_at),
  });
});

module.exports = router;
