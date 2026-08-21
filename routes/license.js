const express = require("express");

const router =
  express.Router();

const {
  db
} = require("../db");

const {
  nowISO,
  daysLeft
} = require("../helpers");

const {
  licenseRateLimit,
  recordInvalidKeyAttempt,
  logActivity,
  checkKeySharing,
  notifyUsage
} = require("../middleware/licenseProtection");

router.use(
  licenseRateLimit
);

function getRequestInfo(req) {
  return {
    ip:
      req.clientIp ||
      req.ip ||
      req.socket?.remoteAddress ||
      "unknown",

    userAgent:
      req.clientUserAgent ||
      req.headers["user-agent"] ||
      "unknown"
  };
}

function safeLicense(row) {
  if (!row) return null;

  return {
    license_key: row.license_key,

    label: row.label,

    expires_at: row.expires_at,

    max_devices:
      Number(row.max_devices || 1),

    status: row.status,

    flagged:
      Number(row.flagged || 0),

    days_left:
      Math.max(
        0,
        daysLeft(row.expires_at)
      )
  };
}

/*
 * POST /api/activate
 *
 * First-time activation/binding.
 */
router.post(
  "/activate",
  async (req, res, next) => {

    try {

      const {
        license_key,
        hwid
      } = req.body || {};

      const {
        ip,
        userAgent
      } = getRequestInfo(req);

      const key =
        String(
          license_key || ""
        ).trim();

      const device =
        String(
          hwid || ""
        ).trim();

      if (!key || !device) {

        await logActivity({
          license_key: key || null,
          hwid: device || null,
          ip,
          userAgent,
          action: "invalid_request",
          success: false
        });

        return res.status(400).json({
          success: false,
          valid: false,
          reason: "missing_parameters"
        });
      }

      const result =
        await db.execute({
          sql: `
            SELECT *
            FROM licenses
            WHERE license_key = ?
            LIMIT 1
          `,
          args: [key]
        });

      const license =
        result.rows[0];

      if (!license) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "invalid_key",
          success: false
        });

        const fails =
          await recordInvalidKeyAttempt(
            ip,
            req
          );

        await notifyUsage({
          action: "invalid_key",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            `Invalid key attempt #${fails}`
        });

        return res.status(404).json({
          success: false,
          valid: false,
          reason: "invalid_key"
        });
      }

      if (
        license.status ===
        "revoked"
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "revoked",
          success: false
        });

        await notifyUsage({
          action: "revoked",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            "Attempted to activate revoked license"
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason: "revoked"
        });
      }

      if (
        new Date(license.expires_at)
          .getTime() <= Date.now()
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "expired",
          success: false
        });

        await notifyUsage({
          action: "expired",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            "Attempted to activate expired license"
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason: "expired"
        });
      }

      const devicesResult =
        await db.execute({
          sql: `
            SELECT hwid
            FROM license_devices
            WHERE license_key = ?
          `,
          args: [key]
        });

      const devices =
        devicesResult.rows;

      const alreadyBound =
        devices.some(
          row =>
            row.hwid === device
        );

      if (
        !alreadyBound &&
        devices.length >=
          Number(
            license.max_devices || 1
          )
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "device_limit",
          success: false
        });

        await notifyUsage({
          action: "device_limit",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            "Maximum device count reached"
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason:
            "device_limit_reached"
        });
      }

      if (!alreadyBound) {

        await db.execute({
          sql: `
            INSERT INTO license_devices
            (
              license_key,
              hwid,
              bound_at
            )
            VALUES (?, ?, ?)
          `,
          args: [
            key,
            device,
            nowISO()
          ]
        });
      }

      await db.execute({
        sql: `
          UPDATE licenses
          SET device_hwid = ?
          WHERE license_key = ?
        `,
        args: [
          device,
          key
        ]
      });

      await logActivity({
        license_key: key,
        hwid: device,
        ip,
        userAgent,
        action: "activate",
        success: true
      });

      await checkKeySharing(
        key,
        ip
      );

      await notifyUsage({
        action: "activate",
        licenseKey: key,
        hwid: device,
        ip,
        userAgent,
        success: true,
        details:
          `Expires ${license.expires_at}`
      });

      return res.json({
        success: true,
        valid: true,
        reason: "activated",
        ...safeLicense(license)
      });

    } catch (err) {
      next(err);
    }
  }
);

/*
 * POST /api/validate
 *
 * Existing device validation.
 */
router.post(
  "/validate",
  async (req, res, next) => {

    try {

      const {
        license_key,
        hwid
      } = req.body || {};

      const {
        ip,
        userAgent
      } = getRequestInfo(req);

      const key =
        String(
          license_key || ""
        ).trim();

      const device =
        String(
          hwid || ""
        ).trim();

      if (!key || !device) {
        return res.status(400).json({
          success: false,
          valid: false,
          reason: "missing_parameters"
        });
      }

      const result =
        await db.execute({
          sql: `
            SELECT *
            FROM licenses
            WHERE license_key = ?
            LIMIT 1
          `,
          args: [key]
        });

      const license =
        result.rows[0];

      if (!license) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "invalid_key",
          success: false
        });

        const fails =
          await recordInvalidKeyAttempt(
            ip,
            req
          );

        await notifyUsage({
          action: "invalid_key",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            `Validation attempt #${fails}`
        });

        return res.status(404).json({
          success: false,
          valid: false,
          reason: "invalid_key"
        });
      }

      if (
        license.status ===
        "revoked"
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "revoked",
          success: false
        });

        await notifyUsage({
          action: "revoked",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason: "revoked"
        });
      }

      if (
        new Date(license.expires_at)
          .getTime() <= Date.now()
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "expired",
          success: false
        });

        await notifyUsage({
          action: "expired",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason: "expired"
        });
      }

      const deviceResult =
        await db.execute({
          sql: `
            SELECT 1
            FROM license_devices
            WHERE license_key = ?
            AND hwid = ?
            LIMIT 1
          `,
          args: [
            key,
            device
          ]
        });

      if (
        deviceResult.rows.length === 0
      ) {

        await logActivity({
          license_key: key,
          hwid: device,
          ip,
          userAgent,
          action: "device_not_bound",
          success: false
        });

        await notifyUsage({
          action: "device_limit",
          licenseKey: key,
          hwid: device,
          ip,
          userAgent,
          success: false,
          details:
            "Device is not bound to this license"
        });

        return res.status(403).json({
          success: false,
          valid: false,
          reason:
            "device_not_bound"
        });
      }

      await logActivity({
        license_key: key,
        hwid: device,
        ip,
        userAgent,
        action: "validate",
        success: true
      });

      await checkKeySharing(
        key,
        ip
      );

      return res.json({
        success: true,
        valid: true,
        reason: "valid",
        ...safeLicense(license)
      });

    } catch (err) {
      next(err);
    }
  }
);

/*
 * POST /api/usage
 *
 * Called by lolo.html when a download starts/completes/fails.
 */
router.post(
  "/usage",
  async (req, res, next) => {

    try {

      const {
        license_key,
        hwid,
        action,
        details
      } = req.body || {};

      const {
        ip,
        userAgent
      } = getRequestInfo(req);

      const allowedActions = [
        "download_start",
        "download_complete",
        "download_failed"
      ];

      if (
        !allowedActions.includes(action)
      ) {
        return res.status(400).json({
          success: false,
          reason: "invalid_action"
        });
      }

      await logActivity({
        license_key:
          license_key || null,

        hwid:
          hwid || null,

        ip,

        userAgent,

        action,

        success:
          action !==
          "download_failed"
      });

      await checkKeySharing(
        license_key,
        ip
      );

      await notifyUsage({
        action,
        licenseKey:
          license_key,
        hwid,
        ip,
        userAgent,
        success:
          action !==
          "download_failed",
        details:
          details || ""
      });

      return res.json({
        success: true
      });

    } catch (err) {
      next(err);
    }
  }
);

module.exports =
  router;
