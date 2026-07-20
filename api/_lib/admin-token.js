// Shared admin session token helpers (CommonJS so both the ESM and CJS
// functions in /api can load it).
// Tokens are stateless HMAC signatures so every serverless function can
// verify them with only the ADMIN_PASSWORD env var — no session table.
// Format: vs1.<expiry-ms>.<hmac-sha256-hex>
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(expiry, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(expiry)).digest('hex');
}

function makeAdminToken(secret) {
  const expiry = Date.now() + TOKEN_TTL_MS;
  return { token: `vs1.${expiry}.${sign(expiry, secret)}`, expires_at: new Date(expiry).toISOString() };
}

function isValidAdminToken(token, secret) {
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'vs1') return false;
  const expiry = Number(parts[1]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = sign(expiry, secret);
  const given = String(parts[2]);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
}

// Reads the Bearer token from a request and verifies it.
function isAuthorizedAdmin(req) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false; // fail closed when the env var is missing
  const header = String(req.headers.authorization || '').replace('Bearer ', '');
  return isValidAdminToken(header, secret);
}

module.exports = { makeAdminToken, isValidAdminToken, isAuthorizedAdmin };
