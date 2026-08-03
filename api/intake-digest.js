// The recurring tick that keeps Laura moving when nobody is watching.
//
// Gmail polling handles anything an applicant says; this handles everything
// that has to happen in silence — files that lost their next step, chases that
// have come due, and the digest that tells Larry what changed. Order matters:
// both sweeps run before the digest so what Larry reads reflects the mail that
// just went out, rather than lagging a full cycle behind it.
import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { runDueFollowUps, sendLauraDigest, sweepStalledThreads } from './_lib/laura-agent.js';

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
    const skip = req.query.skip_followups === 'true';
    // Dropped files first: picking one up usually schedules the chase that the
    // follow-up pass then has to run.
    const swept = skip
      ? { skipped: true }
      : await sweepStalledThreads({}).catch((e) => ({ error: String((e && e.message) || e) }));
    const followUps = skip
      ? { skipped: true }
      : await runDueFollowUps({}).catch((e) => ({ error: String((e && e.message) || e) }));
    const digest = await sendLauraDigest({ force });
    return res.status(200).json({ ...digest, swept, follow_ups: followUps });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
