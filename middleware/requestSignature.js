// Verifies that a request to the license API actually came from your
// client (browser widget / app), not a bare curl/Postman call.
//
// The client and server share a secret (CLIENT_HMAC_SECRET). The client
// signs `${license_key}|${hwid}|${timestamp}` with HMAC-SHA256 and sends
// the timestamp + signature as headers. The server recomputes the same
// HMAC and compares. No DB call needed, so a forged request gets rejected
// before it can burn rate-limit budget or touch the database at all.
//
// This is not unbreakable — someone who fully reverse-engineers the
// client can extract the secret and forge signatures too — but it stops
// casual/automated abuse instantly and forces a real cracker to actually
// dig into your client code instead of just curling the API.

const crypto = require('crypto');

const CLIENT_HMAC_SECRET = process.env.CLIENT_HMAC_SECRET;
const MAX_SKEW_MS = 60 * 1000; // reject requests whose timestamp is >60s off (replay protection)

function verifyRequestSignature(req, res, next) {
  if (!CLIENT_HMAC_SECRET) {
    // Fail closed and log loudly — a missing secret should never silently
    // disable this check in production.
    console.error('CLIENT_HMAC_SECRET is not set — rejecting all license API requests until configured.');
    return res.status(500).json({ success: false, valid: false, reason: 'server_misconfigured' });
  }

  const timestamp = req.headers['x-client-timestamp'];
  const signature = req.headers['x-client-signature'];

  if (!timestamp || !signature) {
    return res.status(401).json({ success: false, valid: false, reason: 'missing_signature' });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return res.status(401).json({ success: false, valid: false, reason: 'stale_request' });
  }

  const { license_key, hwid } = req.body || {};
  const message = `${license_key || ''}|${hwid || ''}|${timestamp}`;

  const expected = crypto.createHmac('sha256', CLIENT_HMAC_SECRET).update(message).digest('hex');

  let sigBuf, expBuf;
  try {
    sigBuf = Buffer.from(signature, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch (e) {
    return res.status(401).json({ success: false, valid: false, reason: 'invalid_signature' });
  }

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).json({ success: false, valid: false, reason: 'invalid_signature' });
  }

  next();
}

module.exports = { verifyRequestSignature };
