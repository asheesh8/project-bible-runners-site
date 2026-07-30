import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { runDueFollowUps, sendLauraDigest } from './_lib/laura-agent.js';

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
    // Chase quiet applicants first so the digest Larry reads reflects the
    // nudges that just went out, rather than lagging six hours behind them.
    const followUps = req.query.skip_followups === 'true'
      ? { skipped: true }
      : await runDueFollowUps({}).catch((e) => ({ error: String((e && e.message) || e) }));
    const digest = await sendLauraDigest({ force });
    return res.status(200).json({ ...digest, follow_ups: followUps });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
