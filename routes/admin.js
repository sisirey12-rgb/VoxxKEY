const express = require('express');
const axios = require('axios');

const { db } = require('../db');
const { requireSession } = require('../middleware/authSession');
const {
  generateKeyString,
  generateResellerToken,
  addDurationISO,
  nowISO,
  computeStatus,
  asyncHandler
} = require('../helpers');

const router = express.Router();

/*
============================================================
PUBLIC VISITOR ROUTES
============================================================

These routes are intentionally BEFORE requireSession.

Required Render environment variables:

TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

GPS is accepted only when the browser explicitly sends:
consent: true
*/


// ============================================================
// GET VISITOR IP
// ============================================================

function getVisitorIp(req) {
  const forwarded = req.headers['x-forwarded-for'];

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}


// ============================================================
// GEOIP
// ============================================================

async function getGeoIP(ip) {
  if (!ip || ip === 'unknown') {
    return null;
  }

  const cleanIp = ip.replace(/^::ffff:/, '');

  const isPrivate =
    cleanIp === '::1' ||
    cleanIp === '127.0.0.1' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanIp);

  if (isPrivate) {
    return null;
  }

  try {
    const response = await axios.get(
      `https://ipwho.is/${encodeURIComponent(cleanIp)}`,
      {
        timeout: 5000
      }
    );

    const data = response.data;

    if (!data || data.success === false) {
      return null;
    }

    return {
      ip: cleanIp,
      country: data.country || null,
      countryCode: data.country_code || null,
      region: data.region || null,
      city: data.city || null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      isp: data.connection?.isp || null,
      org: data.connection?.org || null
    };
  } catch (error) {
    console.error(
      'GeoIP lookup failed:',
      error.message
    );

    return null;
  }
}


// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message) {
  const botToken =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error(
      'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render.'
    );
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
      },
      {
        timeout: 8000
      }
    );

    console.log(
      'Telegram notification sent successfully.'
    );

    return true;
  } catch (error) {
    console.error(
      'Telegram sendMessage failed:',
      error.response?.data || error.message
    );

    return false;
  }
}


// ============================================================
// PRICEVOX VISITOR PING
// POST /admin/ping
// ============================================================

router.post(
  '/ping',
  asyncHandler(async (req, res) => {
    const ip = getVisitorIp(req);

    const geo = await getGeoIP(ip);

    const userAgent =
      req.get('user-agent') || 'Unknown';

    const referrer =
      req.get('referer') || 'Direct';

    const page =
      req.body?.page || 'PriceVox';

    const location = geo
      ? [
          geo.city,
          geo.region,
          geo.country
        ]
          .filter(Boolean)
          .join(', ')
      : 'Unavailable';

    const message = [
      '🔔 VOXX PriceVox Visitor',
      '',
      `🌐 Public IP: ${ip}`,
      `📍 GeoIP: ${location}`,
      `🏢 ISP: ${geo?.isp || 'Unavailable'}`,
      `🏢 Organization: ${geo?.org || 'Unavailable'}`,
      `📄 Page: ${page}`,
      `🔗 Referrer: ${referrer}`,
      `🖥️ User-Agent: ${userAgent}`,
      `🕐 Time: ${new Date().toISOString()}`
    ].join('\n');

    /*
     * Respond first so the website doesn't have to wait
     * for Telegram/GeoIP processing.
     */
    res.json({
      success: true
    });

    sendTelegram(message).catch(error => {
      console.error(
        'Visitor Telegram notification error:',
        error.message
      );
    });
  })
);


// ============================================================
// GPS
// POST /admin/gps
// ============================================================

router.post(
  '/gps',
  asyncHandler(async (req, res) => {
    const {
      latitude,
      longitude,
      accuracy,
      consent
    } = req.body || {};

    /*
     * GPS is accepted only after explicit consent.
     */
    if (consent !== true) {
      return res.status(400).json({
        error: 'explicit GPS consent required'
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const acc = Number(accuracy);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return res.status(400).json({
        error: 'valid GPS coordinates required'
      });
    }

    if (
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        error: 'invalid GPS coordinates'
      });
    }

    const ip = getVisitorIp(req);

    const message = [
      '📍 VOXX GPS Permission Granted',
      '',
      `📌 Latitude: ${lat}`,
      `📌 Longitude: ${lng}`,
      `🎯 Accuracy: ${
        Number.isFinite(acc)
          ? `${Math.round(acc)} m`
          : 'Unavailable'
      }`,
      `🌐 Public IP: ${ip}`,
      `🕐 Time: ${new Date().toISOString()}`
    ].join('\n');

    res.json({
      success: true
    });

    sendTelegram(message).catch(error => {
      console.error(
        'GPS Telegram notification error:',
        error.message
      );
    });
  })
);


// ============================================================
// ADMIN SESSION
// Everything below this point requires a valid session.
// ============================================================

router.use(requireSession);


// ============================================================
// LICENSE KEYS
// ============================================================


// List all keys
router.get(
  '/keys',
  asyncHandler(async (req, res) => {
    const result = await db.execute(`
      SELECT
        l.*,
        r.name AS reseller_name,
        r.status AS reseller_status
      FROM licenses l
      LEFT JOIN resellers r
        ON r.id = l.reseller_id
      ORDER BY l.created_at DESC
    `);

    const withStatus = result.rows.map(row => ({
      ...row,
      computed_status: computeStatus(row)
    }));

    res.json({
      licenses: withStatus
    });
  })
);


// Generate key
router.post(
  '/generate-key',
  asyncHandler(async (req, res) => {
    const {
      validity_days,
      days = 0,
      hours = 0,
      minutes = 0,
      max_devices = 1,
      label = null,
      custom_key,
      license_key: legacyKey
    } = req.body || {};

    const customKey =
      (custom_key || legacyKey || '').trim() || null;

    const totalDays =
      Number(validity_days ?? days) || 0;

    const totalHours =
      Number(hours) || 0;

    const totalMinutes =
      Number(minutes) || 0;

    const totalMs =
      totalDays * 86400000 +
      totalHours * 3600000 +
      totalMinutes * 60000;

    if (
      !Number.isFinite(totalMs) ||
      totalMs <= 0
    ) {
      return res.status(400).json({
        error:
          'provide a positive duration via days, hours, and/or minutes'
      });
    }

    if (
      !Number.isFinite(Number(max_devices)) ||
      Number(max_devices) <= 0
    ) {
      return res.status(400).json({
        error:
          'max_devices must be a positive number'
      });
    }

    if (customKey) {
      const existing = await db.execute({
        sql:
          'SELECT 1 FROM licenses WHERE license_key = ?',
        args: [customKey]
      });

      if (existing.rows.length > 0) {
        return res.status(409).json({
          error:
            'license_key already exists'
        });
      }
    }

    const license_key =
      customKey || generateKeyString();

    const created_at = nowISO();

    const expires_at =
      addDurationISO(
        created_at,
        {
          days: totalDays,
          hours: totalHours,
          minutes: totalMinutes
        }
      );

    await db.execute({
      sql: `
        INSERT INTO licenses
        (
          license_key,
          device_hwid,
          label,
          created_at,
          expires_at,
          max_devices,
          status
        )
        VALUES
        (?, NULL, ?, ?, ?, ?, 'active')
      `,
      args: [
        license_key,
        label,
        created_at,
        expires_at,
        max_devices
      ]
    });

    res.json({
      license_key,
      created_at,
      expires_at,
      max_devices,
      label,
      status: 'active'
    });
  })
);


// Reset HWID
router.post(
  '/reset-hwid',
  asyncHandler(async (req, res) => {
    const {
      license_key
    } = req.body || {};

    if (!license_key) {
      return res.status(400).json({
        error:
          'license_key required'
      });
    }

    const result = await db.execute({
      sql:
        'SELECT * FROM licenses WHERE license_key = ?',
      args: [license_key]
    });

    const lic = result.rows[0];

    if (!lic) {
      return res.status(404).json({
        error:
          'license_key not found'
      });
    }

    await db.execute({
      sql:
        'UPDATE licenses SET device_hwid = NULL WHERE license_key = ?',
      args: [license_key]
    });

    await db.execute({
      sql:
        'DELETE FROM license_devices WHERE license_key = ?',
      args: [license_key]
    });

    res.json({
      success: true
    });
  })
);


// Extend expiry
router.post(
  '/extend',
  asyncHandler(async (req, res) => {
    const {
      license_key,
      days = 0,
      hours = 0,
      minutes = 0
    } = req.body || {};

    const totalDays =
      Number(days) || 0;

    const totalHours =
      Number(hours) || 0;

    const totalMinutes =
      Number(minutes) || 0;

    const totalMs =
      totalDays * 86400000 +
      totalHours * 3600000 +
      totalMinutes * 60000;

    if (!license_key) {
      return res.status(400).json({
        error:
          'license_key required'
      });
    }

    if (
      !Number.isFinite(totalMs) ||
      totalMs <= 0
    ) {
      return res.status(400).json({
        error:
          'provide a positive duration via days, hours, and/or minutes'
      });
    }

    const result = await db.execute({
      sql:
        'SELECT * FROM licenses WHERE license_key = ?',
      args: [license_key]
    });

    const lic = result.rows[0];

    if (!lic) {
      return res.status(404).json({
        error:
          'license_key not found'
      });
    }

    const newExpiry =
      addDurationISO(
        lic.expires_at,
        {
          days: totalDays,
          hours: totalHours,
          minutes: totalMinutes
        }
      );

    await db.execute({
      sql:
        'UPDATE licenses SET expires_at = ? WHERE license_key = ?',
      args: [
        newExpiry,
        license_key
      ]
    });

    res.json({
      success: true,
      expires_at: newExpiry
    });
  })
);


// Regenerate key
router.post(
  '/regenerate',
  asyncHandler(async (req, res) => {
    const {
      license_key
    } = req.body || {};

    if (!license_key) {
      return res.status(400).json({
        error:
          'license_key required'
      });
    }

    const oldResult = await db.execute({
      sql:
        'SELECT * FROM licenses WHERE license_key = ?',
      args: [license_key]
    });

    const old =
      oldResult.rows[0];

    if (!old) {
      return res.status(404).json({
        error:
          'license_key not found'
      });
    }

    const newKey =
      generateKeyString();

    await db.execute({
      sql:
        'UPDATE licenses SET license_key = ? WHERE license_key = ?',
      args: [
        newKey,
        license_key
      ]
    });

    await db.execute({
      sql:
        'UPDATE license_devices SET license_key = ? WHERE license_key = ?',
      args: [
        newKey,
        license_key
      ]
    });

    res.json({
      success: true,
      new_license_key:
        newKey
    });
  })
);


// Revoke key
router.post(
  '/revoke',
  asyncHandler(async (req, res) => {
    const {
      license_key
    } = req.body || {};

    if (!license_key) {
      return res.status(400).json({
        error:
          'license_key required'
      });
    }

    const result = await db.execute({
      sql: `
        UPDATE licenses
        SET status = 'revoked'
        WHERE license_key = ?
      `,
      args: [license_key]
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        error:
          'license_key not found'
      });
    }

    res.json({
      success: true
    });
  })
);


// Delete one key
router.post(
  '/delete-key',
  asyncHandler(async (req, res) => {
    const {
      license_key
    } = req.body || {};

    if (!license_key) {
      return res.status(400).json({
        error:
          'license_key required'
      });
    }

    await db.execute({
      sql:
        'DELETE FROM license_devices WHERE license_key = ?',
      args: [license_key]
    });

    const result = await db.execute({
      sql:
        'DELETE FROM licenses WHERE license_key = ?',
      args: [license_key]
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        error:
          'license_key not found'
      });
    }

    res.json({
      success: true
    });
  })
);


// Delete revoked keys
router.post(
  '/delete-revoked',
  asyncHandler(async (req, res) => {
    await db.execute(`
      DELETE FROM license_devices
      WHERE license_key IN (
        SELECT license_key
        FROM licenses
        WHERE status = 'revoked'
      )
    `);

    const result = await db.execute(`
      DELETE FROM licenses
      WHERE status = 'revoked'
    `);

    res.json({
      success: true,
      deleted:
        result.rowsAffected
    });
  })
);


// ============================================================
// RESELLERS
// ============================================================


// List resellers
router.get(
  '/resellers',
  asyncHandler(async (req, res) => {
    const resellersResult =
      await db.execute(`
        SELECT
          id,
          name,
          credits,
          status,
          created_at
        FROM resellers
        ORDER BY created_at DESC
      `);

    const licensesResult =
      await db.execute(`
        SELECT
          reseller_id,
          status,
          expires_at
        FROM licenses
        WHERE reseller_id IS NOT NULL
      `);

    const counts = {};

    for (const license of licensesResult.rows) {
      const rid =
        license.reseller_id;

      if (!counts[rid]) {
        counts[rid] = {
          total: 0,
          active: 0
        };
      }

      counts[rid].total += 1;

      const status =
        computeStatus(license);

      if (
        status === 'active' ||
        status === 'expiring'
      ) {
        counts[rid].active += 1;
      }
    }

    const resellers =
      resellersResult.rows.map(reseller => {
        const count =
          counts[reseller.id] || {
            total: 0,
            active: 0
          };

        const daysActive =
          Math.max(
            1,
            Math.ceil(
              (
                Date.now() -
                new Date(
                  reseller.created_at
                )
              ) / 86400000
            )
          );

        return {
          ...reseller,
          total_sales:
            count.total,
          active_sales:
            count.active,
          sales_per_day:
            Number(
              (
                count.total /
                daysActive
              ).toFixed(2)
            )
        };
      });

    res.json({
      resellers
    });
  })
);


// Create reseller
router.post(
  '/resellers',
  asyncHandler(async (req, res) => {
    const {
      name,
      initial_credits = 0
    } = req.body || {};

    if (
      !name ||
      !name.trim()
    ) {
      return res.status(400).json({
        error:
          'name required'
      });
    }

    if (
      !Number.isFinite(
        Number(initial_credits)
      ) ||
      Number(initial_credits) < 0
    ) {
      return res.status(400).json({
        error:
          'initial_credits must be zero or a positive number'
      });
    }

    const token =
      generateResellerToken();

    const created_at =
      nowISO();

    const result =
      await db.execute({
        sql: `
          INSERT INTO resellers
          (
            name,
            token,
            credits,
            created_at,
            status
          )
          VALUES
          (?, ?, ?, ?, 'active')
        `,
        args: [
          name.trim(),
          token,
          initial_credits,
          created_at
        ]
      });

    res.json({
      id:
        Number(
          result.lastInsertRowid
        ),
      name:
        name.trim(),
      token,
      credits:
        initial_credits,
      status:
        'active'
    });
  })
);


// Adjust reseller credits
router.post(
  '/resellers/:id/adjust-credits',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    const { delta } =
      req.body || {};

    if (
      !Number.isFinite(
        Number(delta)
      ) ||
      Number(delta) === 0
    ) {
      return res.status(400).json({
        error:
          'delta must be a non-zero number'
      });
    }

    const result =
      await db.execute({
        sql:
          'UPDATE resellers SET credits = credits + ? WHERE id = ?',
        args: [
          delta,
          id
        ]
      });

    if (
      result.rowsAffected === 0
    ) {
      return res.status(404).json({
        error:
          'reseller not found'
      });
    }

    const updated =
      await db.execute({
        sql:
          'SELECT credits FROM resellers WHERE id = ?',
        args: [id]
      });

    res.json({
      success: true,
      credits:
        updated.rows[0]?.credits
    });
  })
);


// Suspend/reactivate reseller
router.post(
  '/resellers/:id/set-status',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    const { status } =
      req.body || {};

    if (
      !['active', 'suspended']
        .includes(status)
    ) {
      return res.status(400).json({
        error:
          "status must be 'active' or 'suspended'"
      });
    }

    const result =
      await db.execute({
        sql:
          'UPDATE resellers SET status = ? WHERE id = ?',
        args: [
          status,
          id
        ]
      });

    if (
      result.rowsAffected === 0
    ) {
      return res.status(404).json({
        error:
          'reseller not found'
      });
    }

    res.json({
      success: true
    });
  })
);


// Delete reseller
router.delete(
  '/resellers/:id',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    await db.execute({
      sql:
        'DELETE FROM credit_topups WHERE reseller_id = ?',
      args: [id]
    });

    const result =
      await db.execute({
        sql:
          'DELETE FROM resellers WHERE id = ?',
        args: [id]
      });

    if (
      result.rowsAffected === 0
    ) {
      return res.status(404).json({
        error:
          'reseller not found'
      });
    }

    res.json({
      success: true
    });
  })
);


// Reseller sales
router.get(
  '/resellers/:id/sales',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    const result =
      await db.execute({
        sql: `
          SELECT *
          FROM licenses
          WHERE reseller_id = ?
          ORDER BY created_at DESC
        `,
        args: [id]
      });

    const withStatus =
      result.rows.map(row => ({
        ...row,
        computed_status:
          computeStatus(row)
      }));

    res.json({
      licenses:
        withStatus
    });
  })
);


// ============================================================
// CREDIT TOPUPS
// ============================================================


// List topups
router.get(
  '/topups',
  asyncHandler(async (req, res) => {
    const { status } =
      req.query;

    const sql = status
      ? `
        SELECT
          t.*,
          r.name AS reseller_name
        FROM credit_topups t
        JOIN resellers r
          ON r.id = t.reseller_id
        WHERE t.status = ?
        ORDER BY t.requested_at DESC
      `
      : `
        SELECT
          t.*,
          r.name AS reseller_name
        FROM credit_topups t
        JOIN resellers r
          ON r.id = t.reseller_id
        ORDER BY t.requested_at DESC
      `;

    const result =
      await db.execute(
        status
          ? {
              sql,
              args: [status]
            }
          : sql
      );

    res.json({
      topups:
        result.rows
    });
  })
);


// Approve topup
router.post(
  '/topups/:id/approve',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    const topupResult =
      await db.execute({
        sql:
          'SELECT * FROM credit_topups WHERE id = ?',
        args: [id]
      });

    const topup =
      topupResult.rows[0];

    if (!topup) {
      return res.status(404).json({
        error:
          'topup not found'
      });
    }

    if (
      topup.status !== 'pending'
    ) {
      return res.status(409).json({
        error:
          `topup already ${topup.status}`
      });
    }

    await db.execute({
      sql:
        'UPDATE resellers SET credits = credits + ? WHERE id = ?',
      args: [
        topup.amount,
        topup.reseller_id
      ]
    });

    await db.execute({
      sql: `
        UPDATE credit_topups
        SET
          status = 'approved',
          resolved_at = ?
        WHERE id = ?
      `,
      args: [
        nowISO(),
        id
      ]
    });

    res.json({
      success: true
    });
  })
);


// Reject topup
router.post(
  '/topups/:id/reject',
  asyncHandler(async (req, res) => {
    const { id } =
      req.params;

    const topupResult =
      await db.execute({
        sql:
          'SELECT * FROM credit_topups WHERE id = ?',
        args: [id]
      });

    const topup =
      topupResult.rows[0];

    if (!topup) {
      return res.status(404).json({
        error:
          'topup not found'
      });
    }

    if (
      topup.status !== 'pending'
    ) {
      return res.status(409).json({
        error:
          `topup already ${topup.status}`
      });
    }

    await db.execute({
      sql: `
        UPDATE credit_topups
        SET
          status = 'rejected',
          resolved_at = ?
        WHERE id = ?
      `,
      args: [
        nowISO(),
        id
      ]
    });

    res.json({
      success: true
    });
  })
);


module.exports = router;
