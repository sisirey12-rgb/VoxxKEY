const crypto = require("crypto");

function generateKeyString() {
  const len =
    8 + Math.floor(Math.random() * 3);

  const bytesNeeded =
    Math.ceil(len / 2);

  const suffix =
    crypto
      .randomBytes(bytesNeeded)
      .toString("hex")
      .toUpperCase()
      .slice(0, len);

  return `VOXX-${suffix}`;
}

function generateResellerToken() {
  return (
    "rsl_" +
    crypto
      .randomBytes(24)
      .toString("hex")
  );
}

function addDaysISO(
  fromISO,
  days
) {
  const d = new Date(fromISO);

  d.setDate(
    d.getDate() + Number(days)
  );

  return d.toISOString();
}

function addDurationISO(
  fromISO,
  {
    days = 0,
    hours = 0,
    minutes = 0
  } = {}
) {
  const totalMs =
    (Number(days) || 0) *
      86400000 +
    (Number(hours) || 0) *
      3600000 +
    (Number(minutes) || 0) *
      60000;

  return new Date(
    new Date(fromISO).getTime() +
      totalMs
  ).toISOString();
}

function nowISO() {
  return new Date().toISOString();
}

function daysLeft(
  expiresAtISO
) {
  return Math.ceil(
    (
      new Date(expiresAtISO) -
      new Date()
    ) / 86400000
  );
}

function computeStatus(lic) {
  if (lic.status === "revoked") {
    return "revoked";
  }

  if (
    daysLeft(lic.expires_at) < 0
  ) {
    return "expired";
  }

  if (
    daysLeft(lic.expires_at) <= 5
  ) {
    return "expiring";
  }

  return "active";
}

function asyncHandler(fn) {
  return function (
    req,
    res,
    next
  ) {
    Promise
      .resolve(
        fn(req, res, next)
      )
      .catch(next);
  };
}

module.exports = {
  generateKeyString,
  generateResellerToken,
  addDaysISO,
  addDurationISO,
  nowISO,
  daysLeft,
  computeStatus,
  asyncHandler
};
