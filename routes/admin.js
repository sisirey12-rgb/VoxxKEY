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
VOXX ADMIN ROUTES
============================================================

PUBLIC:
  POST /admin/ping
  POST /admin/gps

PROTECTED:
  Everything after router.use(requireSession)

Telegram:
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID

IMPORTANT:
  GPS is accepted only when the browser explicitly grants
  permission and the frontend sends consent: true.
============================================================
*/


/* ============================================================
   VISITOR IP
============================================================ */

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


/* ============================================================
   GEOIP / ISP
============================================================ */

async function getGeoIP(ip) {

  if (!ip || ip === 'unknown') {
    return null;
  }

  const cleanIp = String(ip)
    .replace(/^::ffff:/, '')
    .trim();

  const isPrivate =
    cleanIp === '::1' ||
    cleanIp === '127.0.0.1' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp);

  if (isPrivate) {
    return null;
  }

  try {

    const response = await axios.get(
      `https://ipwho.is/${encodeURIComponent(cleanIp)}`,
      {
        timeout: 7000
      }
    );

    const data = response.data;

    if (!data || data.success === false) {
      return null;
    }

    return {
      ip: cleanIp,
      country: data.country || null,
      country_code: data.country_code || null,
      region: data.region || null,
      city: data.city || null,
      postal: data.postal || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      isp: data.connection?.isp || null,
      org: data.connection?.org || null,
      asn: data.connection?.asn || null
    };

  } catch (error) {

    console.error(
      '[GeoIP] lookup failed:',
      error.message
    );

    return null;
  }
}


/* ============================================================
   TELEGRAM
============================================================ */

async function sendTelegram(message) {

  const botToken =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {

    console.error(
      '[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID'
    );

    return false;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      {
        timeout: 10000
      }
    );

    console.log(
      '[Telegram] notification sent'
    );

    return true;

  } catch (error) {

    console.error(
      '[Telegram] sendMessage failed:',
      error.response?.data || error.message
    );

    return false;
  }
}


/* ============================================================
   SAFE TELEGRAM TEXT
============================================================ */

function tg(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 'Unavailable';
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


/* ============================================================
   PUBLIC VISITOR PING
============================================================ */

router.post(
  '/ping',
  asyncHandler(async (req, res) => {

    const ip =
      getVisitorIp(req);

    const body =
      req.body || {};

    const geo =
      await getGeoIP(ip);

    const userAgent =
      body.user_agent ||
      req.get('user-agent') ||
      'Unknown';

    const browser =
      body.browser ||
      'Unknown';

    const android =
      body.android_version ||
      'Not detected';

    const platform =
      body.platform ||
      'Unknown';

    const language =
      body.browser_language ||
      'Unknown';

    const languages =
      body.languages ||
      'Unknown';

    const screen =
      body.screen ||
      'Unknown';

    const resolution =
      body.screen_available ||
      'Unknown';

    const pixelRatio =
      body.pixel_ratio ||
      'Unknown';

    const touchPoints =
      body.touch_points ??
      'Unknown';

    const memory =
      body.device_memory_gb ||
      'Unknown';

    const cpu =
      body.hardware_concurrency ||
      'Unknown';

    const timezone =
      body.timezone ||
      'Unknown';

    const page =
      body.page ||
      'Unknown';

    const referrer =
      body.referrer ||
      'Direct';

    const location =
      geo
        ? [
            geo.city,
            geo.region,
            geo.country
          ]
          .filter(Boolean)
          .join(', ')
        : 'Unavailable';

    const time =
      new Date().toISOString();


    const message = [
      '╔══════════════════════════╗',
      '║     <b>VOXX · PRICEVOX</b>     ║',
      '╚══════════════════════════╝',
      '',
      '🟢 <b>NEW VISITOR DETECTED</b>',
      '',
      '🌐 <b>NETWORK</b>',
      `├ IP: <code>${tg(ip)}</code>`,
      `├ ISP: ${tg(geo?.isp)}`,
      `├ Organization: ${tg(geo?.org)}`,
      `├ ASN: ${tg(geo?.asn)}`,
      `└ GeoIP: ${tg(location)}`,
      '',
      '📱 <b>DEVICE</b>',
      `├ Platform: ${tg(platform)}`,
      `├ Android: ${tg(android)}`,
      `├ Browser: ${tg(browser)}`,
      `├ Screen: ${tg(screen)}`,
      `├ Available: ${tg(resolution)}`,
      `├ Pixel Ratio: ${tg(pixelRatio)}`,
      `├ Touch Points: ${tg(touchPoints)}`,
      `├ RAM Hint: ${tg(memory)} GB`,
      `└ CPU Threads: ${tg(cpu)}`,
      '',
      '🌍 <b>BROWSER</b>',
      `├ Language: ${tg(language)}`,
      `├ Languages: ${tg(languages)}`,
      `└ Timezone: ${tg(timezone)}`,
      '',
      '📄 <b>SESSION</b>',
      `├ Page: ${tg(page)}`,
      `├ Referrer: ${tg(referrer)}`,
      `└ Time: ${tg(time)}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '<i>VOXX PriceVox Visitor Monitor</i>'
    ].join('\n');


    /*
    Respond immediately so the website does not
    have to wait for Telegram.
    */

    res.json({
      success: true
    });


    /*
    Send notification in background.
    */

    sendTelegram(message)
      .catch(error => {
        console.error(
          '[Visitor Telegram]',
          error.message
        );
      });

  })
);


/* ============================================================
   PUBLIC GPS
============================================================ */

router.post(
  '/gps',
  asyncHandler(async (req, res) => {

    const {
      latitude,
      longitude,
      accuracy,
      consent,
      device
    } = req.body || {};


    /*
    Explicit consent required.
    */

    if (consent !== true) {

      return res.status(400).json({
        error:
          'explicit GPS consent required'
      });
    }


    const lat =
      Number(latitude);

    const lng =
      Number(longitude);

    const acc =
      Number(accuracy);


    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {

      return res.status(400).json({
        error:
          'valid GPS coordinates required'
      });
    }


    if (
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {

      return res.status(400).json({
        error:
          'invalid GPS coordinates'
      });
    }


    const ip =
      getVisitorIp(req);

    const geo =
      await getGeoIP(ip);


    const location =
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`;


    const message = [
      '╔══════════════════════════╗',
      '║     <b>VOXX · PRICEVOX</b>     ║',
      '╚══════════════════════════╝',
      '',
      '📍 <b>PRECISE LOCATION SHARED</b>',
      '',
      '🛰️ <b>GPS</b>',
      `├ Coordinates: <code>${tg(location)}</code>`,
      `├ Accuracy: ${Number.isFinite(acc) ? Math.round(acc) + ' m' : 'Unavailable'}`,
      '',
      '🌐 <b>NETWORK</b>',
      `├ IP: <code>${tg(ip)}</code>`,
      `├ ISP: ${tg(geo?.isp)}`,
      `├ Organization: ${tg(geo?.org)}`,
      `└ GeoIP: ${tg(
        geo
          ? [
              geo.city,
              geo.region,
              geo.country
            ]
            .filter(Boolean)
            .join(', ')
          : 'Unavailable'
      )}`,
      '',
      '📱 <b>DEVICE</b>',
      `├ Platform: ${tg(device?.platform)}`,
      `├ Android: ${tg(device?.android_version)}`,
      `├ Browser: ${tg(device?.browser)}`,
      `└ Screen: ${tg(device?.screen)}`,
      '',
      '✅ <b>Browser GPS permission granted</b>',
      `🕐 ${new Date().toISOString()}`,
      '',
      '<i>VOXX PriceVox Location Monitor</i>'
    ].join('\n');


    res.json({
      success: true
    });


    sendTelegram(message)
      .catch(error => {
        console.error(
          '[GPS Telegram]',
          error.message
        );
      });

  })
);


/* ============================================================
   EVERYTHING BELOW REQUIRES ADMIN SESSION
============================================================ */

router.use(requireSession);


/* ============================================================
   LICENSE KEYS
============================================================ */

router.get(
  '/keys',
  asyncHandler(async (req, res) => {

    const result =
      await db.execute(`
        SELECT
          l.*,
          r.name AS reseller_name,
          r.status AS reseller_status
        FROM licenses l
        LEFT JOIN resellers r
          ON r.id = l.reseller_id
        ORDER BY l.created_at DESC
      `);

    const licenses =
      result.rows.map(row => ({
        ...row,
        computed_status:
          computeStatus(row)
      }));

    res.json({
      licenses
    });

  })
);


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
      (custom_key || legacyKey || '')
        .trim() || null;


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

      const existing =
        await db.execute({
          sql:
            'SELECT 1 FROM licenses WHERE license_key = ?',
          args: [customKey]
        });

      if (existing.rows.length) {

        return res.status(409).json({
          error:
            'license_key already exists'
        });
      }
    }


    const license_key =
      customKey ||
      generateKeyString();

    const created_at =
      nowISO();

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
        VALUES (?, NULL, ?, ?, ?, ?, 'active')
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


    const result =
      await db.execute({
        sql:
          'SELECT * FROM licenses WHERE license_key = ?',
        args: [license_key]
      });


    if (!result.rows[0]) {

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


router.post(
  '/extend',
  asyncHandler(async (req, res) => {

    const {
      license_key,
      days = 0,
      hours = 0,
      minutes = 0
    } = req.body || {};


    if (!license_key) {

      return res.status(400).json({
        error:
          'license_key required'
      });
    }


    const d =
      Number(days) || 0;

    const h =
      Number(hours) || 0;

    const m =
      Number(minutes) || 0;


    const totalMs =
      d * 86400000 +
      h * 3600000 +
      m * 60000;


    if (
      !Number.isFinite(totalMs) ||
      totalMs <= 0
    ) {

      return res.status(400).json({
        error:
          'provide a positive duration via days, hours, and/or minutes'
      });
    }


    const result =
      await db.execute({
        sql:
          'SELECT * FROM licenses WHERE license_key = ?',
        args: [license_key]
      });


    const license =
      result.rows[0];


    if (!license) {

      return res.status(404).json({
        error:
          'license_key not found'
      });
    }


    const expires_at =
      addDurationISO(
        license.expires_at,
        {
          days: d,
          hours: h,
          minutes: m
        }
      );


    await db.execute({
      sql:
        'UPDATE licenses SET expires_at = ? WHERE license_key = ?',
      args: [
        expires_at,
        license_key
      ]
    });


    res.json({
      success: true,
      expires_at
    });

  })
);


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


    const result =
      await db.execute({
        sql:
          'SELECT * FROM licenses WHERE license_key = ?',
        args: [license_key]
      });


    if (!result.rows[0]) {

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


    const result =
      await db.execute({
        sql:
          `UPDATE licenses
           SET status = 'revoked'
           WHERE license_key = ?`,
        args: [license_key]
      });


    if (!result.rowsAffected) {

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


    const result =
      await db.execute({
        sql:
          'DELETE FROM licenses WHERE license_key = ?',
        args: [license_key]
      });


    if (!result.rowsAffected) {

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


    const result =
      await db.execute(`
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


/* ============================================================
   RESELLERS
============================================================ */

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


    for (
      const license
      of licensesResult.rows
    ) {

      const id =
        license.reseller_id;


      if (!counts[id]) {

        counts[id] = {
          total: 0,
          active: 0
        };
      }


      counts[id].total++;


      const status =
        computeStatus(license);


      if (
        status === 'active' ||
        status === 'expiring'
      ) {

        counts[id].active++;
      }
    }


    const resellers =
      resellersResult.rows.map(
        reseller => {

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

        }
      );


    res.json({
      resellers
    });

  })
);


router.post(
  '/resellers',
  asyncHandler(async (req, res) => {

    const {
      name,
      initial_credits = 0
    } = req.body || {};


    if (!name || !name.trim()) {

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
          VALUES (?, ?, ?, ?, 'active')
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
        Number(result.lastInsertRowid),
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


router.post(
  '/resellers/:id/adjust-credits',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;

    const {
      delta
    } = req.body || {};


    if (
      !Number.isFinite(Number(delta)) ||
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


    if (!result.rowsAffected) {

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


router.post(
  '/resellers/:id/set-status',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;

    const {
      status
    } = req.body || {};


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


    if (!result.rowsAffected) {

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


router.delete(
  '/resellers/:id',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;


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


    if (!result.rowsAffected) {

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


router.get(
  '/resellers/:id/sales',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;


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


    res.json({
      licenses:
        result.rows.map(row => ({
          ...row,
          computed_status:
            computeStatus(row)
        }))
    });

  })
);


/* ============================================================
   TOPUPS
============================================================ */

router.get(
  '/topups',
  asyncHandler(async (req, res) => {

    const {
      status
    } = req.query;


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


router.post(
  '/topups/:id/approve',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;


    const result =
      await db.execute({
        sql:
          'SELECT * FROM credit_topups WHERE id = ?',
        args: [id]
      });


    const topup =
      result.rows[0];


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


router.post(
  '/topups/:id/reject',
  asyncHandler(async (req, res) => {

    const {
      id
    } = req.params;


    const result =
      await db.execute({
        sql:
          'SELECT * FROM credit_topups WHERE id = ?',
        args: [id]
      });


    const topup =
      result.rows[0];


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
