import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { pollGmailInbox } from './_lib/laura-agent.js';

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
    const limit = Number(req.query.limit || (req.body && req.body.limit) || 10);
    const autoRun = req.query.auto_run !== 'false' && !(req.body && req.body.auto_run === false);
    return res.status(200).json(await pollGmailInbox({ limit, autoRun }));
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
