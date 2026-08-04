import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { actionUrl } from './_lib/laura-links.js';
import {
  ensureThreadForApplication,
  ensureThreadsForRecentApplications,
  fileDeploymentForThread,
  intakeHealth,
  listLauraThreads,
  performLarryAction,
  pollGmailInbox,
  runAllWaitingThreads,
  runDueFollowUps,
  runLauraAgent,
  sendLauraDigest,
  sendMessageById,
  sweepStalledThreads,
} from './_lib/laura-agent.js';

function cleanId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
}

function bodyOf(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      if (req.query.action === 'health') return res.status(200).json(await intakeHealth());
      const includeMessages = req.query.include_messages === '1' || req.query.include_messages === 'true';
      return res.status(200).json(await listLauraThreads({ includeMessages }));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = bodyOf(req);
    const action = String(req.query.action || b.action || '').trim();
    if (action === 'health') return res.status(200).json(await intakeHealth());

    if (action === 'ensure-recent') {
      return res.status(200).json({ ok: true, threads: await ensureThreadsForRecentApplications({ limit: Number(b.limit || 30) }) });
    }

    if (action === 'ensure-thread') {
      const applicationId = cleanId(req.query.application_id || b.application_id || req.query.id || b.id);
      if (!applicationId) return res.status(400).json({ error: 'application_id is required' });
      return res.status(200).json({ ok: true, thread: await ensureThreadForApplication(applicationId) });
    }

    if (action === 'run-thread') {
      const threadId = cleanId(req.query.thread_id || b.thread_id);
      const applicationId = cleanId(req.query.application_id || b.application_id);
      if (!threadId && !applicationId) return res.status(400).json({ error: 'thread_id or application_id is required' });
      // No auto_send override here on purpose: autoSendGate is the only thing
      // that decides whether mail leaves, so there is one answer rather than
      // one per caller.
      return res.status(200).json(await runLauraAgent({ threadId, applicationId, reason: 'admin' }));
    }

    if (action === 'approve-send') {
      const messageId = cleanId(req.query.message_id || b.message_id || req.query.id || b.id);
      if (!messageId) return res.status(400).json({ error: 'message_id is required' });
      return res.status(200).json({ ok: true, result: await sendMessageById(messageId) });
    }

    if (action === 'send-digest') {
      return res.status(200).json(await sendLauraDigest({ force: b.force === true || req.query.force === 'true' }));
    }

    if (action === 'poll-gmail') {
      return res.status(200).json(await pollGmailInbox({ limit: Number(b.limit || 10), autoRun: b.auto_run !== false }));
    }

    if (action === 'run-all') {
      return res.status(200).json(await runAllWaitingThreads({
        limit: Number(b.limit || 40),
        dryRun: b.dry_run === true || req.query.dry_run === 'true',
      }));
    }

    if (action === 'run-followups') {
      return res.status(200).json(await runDueFollowUps({ limit: Number(b.limit || 25) }));
    }

    if (action === 'sweep') {
      return res.status(200).json(await sweepStalledThreads({
        limit: Number(b.limit || 15),
        dryRun: b.dry_run === true || req.query.dry_run === 'true',
      }));
    }

    // The panel opens the same signed order form the email links to, rather
    // than a second copy that could drift away from it.
    if (action === 'order-url') {
      const threadId = cleanId(req.query.thread_id || b.thread_id);
      if (!threadId) return res.status(400).json({ error: 'thread_id is required' });
      return res.status(200).json({ ok: true, url: actionUrl(threadId, 'order-form') });
    }

    // Same effects as the buttons in Larry's email, driven from the panel.
    if (action === 'larry-action') {
      const threadId = cleanId(req.query.thread_id || b.thread_id);
      const choice = String(req.query.larry_action || b.larry_action || '').trim();
      if (!threadId) return res.status(400).json({ error: 'thread_id is required' });
      return res.status(200).json(await performLarryAction(threadId, choice));
    }

    if (action === 'file-deployment') {
      const threadId = cleanId(req.query.thread_id || b.thread_id);
      if (!threadId) return res.status(400).json({ error: 'thread_id is required' });
      return res.status(200).json(await fileDeploymentForThread(threadId));
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
