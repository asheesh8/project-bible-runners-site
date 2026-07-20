// Vercel serverless function — admin auth
// Env var: ADMIN_PASSWORD (required — login is disabled until it is set)
// Returns a signed, expiring session token; the password itself is never
// used as a bearer credential.
import crypto from 'node:crypto';
import { makeAdminToken } from './_lib/admin-token.js';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin login is not configured (ADMIN_PASSWORD env var missing)' });

  const { password } = req.body || {};
  if (password && safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(200).json(makeAdminToken(ADMIN_PASSWORD));
  }
  return res.status(401).json({ error: 'Incorrect password' });
}
