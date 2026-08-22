const { db } = require("../db");
const {
  sendTelegram,
  escapeTelegram
} = require("../utils/telegram");

const IP_WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_IP = 30;

const MAX_INVALID_PER_IP = 8;
const IP_LOCKOUT_MINUTES = 60;

const SHARE_WINDOW_MINUTES = 30;
const SHARE_IP_THRESHOLD = 4;

const SHARE_ALERT_COOLDOWN_MINUTES = 60;

const lastShareAlert = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getUserAgent(req) {
  return req.headers["user-agent"] || "unknown";
}

async function isIpLocked(ip) {
  await db.execute({
    sql: `
      DELETE FROM lockouts
      WHERE scope_type = 'license_ip'
      AND locked_until <= datetime('now')
    `
  });

  const result = await db.execute({
    sql: `
      SELECT locked_until
      FROM lockouts
      WHERE scope_type = 'license_ip'
      AND scope_value = ?
      AND locked_until > datetime('now')
    `,
    args: [ip]
  });

  return result.rows[0] || null;
}

async function lockIp(ip, minutes, reason) {
  await db.execute({
    sql: `
      INSERT OR REPLACE INTO lockouts
      (scope_type, scope_value, locked_until)
      VALUES (
        'license_ip',
        ?,
        datetime('now', '+' || ? || ' minutes')
      )
    `,
    args: [ip, minutes]
  });

  await sendTelegram(
`🚫 <b>YORVOXX LICENSE API — IP LOCKED</b>

🌐 IP: <code>${escapeTelegram(ip)}</code>
⚠️ Reason: ${escapeTelegram(reason)}
⏱ Locked for: ${minutes} minutes`
  );
}

async function logActivity({
  license_key = null,
  hwid = null,
  ip,
  userAgent = null,
  action,
  success
}) {
  try {
    await db.execute({
      sql: `
        INSERT INTO license_activity
        (
          license_key,
          hwid,
          ip,
          user_agent,
          action,
          success,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      args: [
        license_key,
        hwid,
        ip,
        userAgent,
        action,
        success ? 1 : 0
      ]
    });
  } catch (err) {
    console.error("[LicenseActivity]", err);
  }
}

async function licenseRateLimit(req, res, next) {
  try {
    const ip = getClientIp(req);

    req.clientIp = ip;
    req.clientUserAgent = getUserAgent(req);

    const locked = await isIpLocked(ip);

    if (locked) {
      return res.status(429).json({
        success: false,
        valid: false,
        reason: "rate_limited"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT COUNT(*) AS n
        FROM license_activity
        WHERE ip = ?
        AND created_at >
          datetime(
            'now',
            '-' || ? || ' minutes'
          )
      `,
      args: [
        ip,
        IP_WINDOW_MINUTES
      ]
    });

    const attempts = Number(
      result.rows[0]?.n || 0
    );

    if (attempts >= MAX_ATTEMPTS_PER_IP) {
      await lockIp(
        ip,
        IP_LOCKOUT_MINUTES,
        `${attempts} license API requests in ${IP_WINDOW_MINUTES} minutes`
      );

      return res.status(429).json({
        success: false,
        valid: false,
        reason: "rate_limited"
      });
    }

    next();

  } catch (err) {
    console.error(
      "[licenseRateLimit]",
      err
    );

    // Fail open for database failures.
    next();
  }
}

async function recordInvalidKeyAttempt(
  ip,
  req = null
) {
  const result = await db.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM license_activity
      WHERE ip = ?
      AND action = 'invalid_key'
      AND created_at >
        datetime(
          'now',
          '-' || ? || ' minutes'
        )
    `,
    args: [
      ip,
      IP_WINDOW_MINUTES
    ]
  });

  const fails = Number(
    result.rows[0]?.n || 0
  );

  if (fails >= MAX_INVALID_PER_IP) {
    await lockIp(
      ip,
      IP_LOCKOUT_MINUTES,
      `${fails} invalid license attempts in ${IP_WINDOW_MINUTES} minutes`
    );
  }

  return fails;
}

async function checkKeySharing(
  licenseKey,
  ip
) {
  if (!licenseKey || !ip) {
    return false;
  }

  const result = await db.execute({
    sql: `
      SELECT DISTINCT ip
      FROM license_activity
      WHERE license_key = ?
      AND created_at >
        datetime(
          'now',
          '-' || ? || ' minutes'
        )
    `,
    args: [
      licenseKey,
      SHARE_WINDOW_MINUTES
    ]
  });

  const distinctIps = new Set(
    result.rows.map(row => row.ip)
  );

  distinctIps.add(ip);

  if (
    distinctIps.size <
    SHARE_IP_THRESHOLD
  ) {
    return false;
  }

  const now = Date.now();

  const last =
    lastShareAlert.get(licenseKey) || 0;

  if (
    now - last <
    SHARE_ALERT_COOLDOWN_MINUTES * 60000
  ) {
    return true;
  }

  lastShareAlert.set(
    licenseKey,
    now
  );

  try {
    await db.execute({
      sql: `
        UPDATE licenses
        SET flagged = 1
        WHERE license_key = ?
      `,
      args: [licenseKey]
    });
  } catch (err) {
    console.error(
      "[SharingFlag]",
      err
    );
  }

  await sendTelegram(
`⚠️ <b>YORVOXX LICENSE SHARING SUSPECTED</b>

🔑 Key:
<code>${escapeTelegram(licenseKey)}</code>

🌐 Distinct IPs:
<b>${distinctIps.size}</b>

⏱ Window:
${SHARE_WINDOW_MINUTES} minutes

📍 IPs:
<code>${escapeTelegram(
  [...distinctIps].join(", ")
)}</code>

🚩 The license has been flagged in the database.`
  );

  return true;
}

async function notifyUsage({
  action,
  licenseKey = null,
  hwid = null,
  ip = null,
  userAgent = null,
  success = true,
  details = ""
}) {
  const icons = {
    activate: "🔓",
    validate: "🔎",
    download_start: "⬇️",
    download_complete: "✅",
    download_failed: "❌",
    invalid_key: "🚫",
    expired: "⌛",
    revoked: "🛑",
    device_limit: "📱",
    rate_limited: "⚠️"
  };

  const icon =
    icons[action] || "📡";

  const status =
    success ? "SUCCESS" : "FAILED";

  await sendTelegram(
`${icon} <b>YORVOXX USAGE</b>

<b>Action:</b> ${escapeTelegram(action)}
<b>Status:</b> ${status}

🔑 <b>License:</b>
<code>${escapeTelegram(licenseKey || "unknown")}</code>

🖥 <b>HWID:</b>
<code>${escapeTelegram(hwid || "unknown")}</code>

🌐 <b>IP:</b>
<code>${escapeTelegram(ip || "unknown")}</code>

📱 <b>User-Agent:</b>
<code>${escapeTelegram(userAgent || "unknown")}</code>

${details ? `📝 <b>Details:</b> ${escapeTelegram(details)}` : ""}`
  );
}

module.exports = {
  getClientIp,
  licenseRateLimit,
  recordInvalidKeyAttempt,
  logActivity,
  checkKeySharing,
  notifyUsage
};
