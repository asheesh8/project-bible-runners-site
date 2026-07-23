import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { sendLauraDigest } from './_lib/laura-agent.js';

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = String(req.query.secret || req.headers['x-cron-secret'] || header || '');
  return given && given === secret;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorizedCron(req) && !isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const force = req.query.force === 'true' || (req.body && req.body.force === true);
    return res.status(200).json(await sendLauraDigest({ force }));
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
