// /api/laura-action — the landing point for the buttons in Larry's intake email.
//
// A GET only ever *shows* something. Anything that emails an applicant or
// changes an application's status needs a POST from the confirmation page,
// because mail scanners and link prefetchers follow GETs and none of them
// should be able to approve or decline a missionary's application.
//
// Authorisation is the signed token in the link itself — Larry reads mail on a
// phone that is not logged into the admin panel, so requiring the admin session
// here would defeat the purpose. Tokens name one thread and one action, expire,
// and are verified with a constant-time comparison.
import { actionMeta, verifyActionToken } from './_lib/laura-links.js';
import { renderActionPage, renderOrderForm } from './_lib/laura-email.js';
import { buildOrderForm, performLarryAction } from './_lib/laura-agent.js';

function page(res, status, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).send(html);
}

const PROBLEMS = {
  unreadable: {
    title: 'That link did not work',
    message: 'The link looks incomplete — some mail apps cut long links in half.',
    detail: 'Open the admin panel and act on the file there instead.',
  },
  bad_signature: {
    title: 'That link did not work',
    message: 'This link could not be verified, so nothing was changed.',
    detail: 'If you typed or edited the address, go back to the original email and tap the button again.',
  },
  expired: {
    title: 'This link has expired',
    message: 'Action links stop working after two weeks so an old email cannot change a live file.',
    detail: 'Open the admin panel, or wait for the next digest and use the fresh buttons there.',
  },
  unconfigured: {
    title: 'Not set up yet',
    message: 'Action links are not configured on the server.',
    detail: 'Set LAURA_ACTION_SECRET (or ADMIN_PASSWORD) in the Vercel environment variables and redeploy.',
  },
};

// The pages that collect a tracking number or a donation link submit as a plain
// HTML form, so the body arrives urlencoded rather than as JSON. Vercel normally
// parses both, but a string body must still be handled or Larry's typing is
// silently dropped and he is told it worked.
function parseBody(req) {
  const raw = req && req.body;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const text = String(raw);
    if (text.trim().startsWith('{')) return JSON.parse(text);
    return Object.fromEntries(new URLSearchParams(text));
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return page(res, 405, renderActionPage({
      title: 'Not allowed', tone: 'stop', message: 'That request method is not supported here.',
    }));
  }

  const body = parseBody(req);
  const token = String((req.query && req.query.token) || body.token || '');
  const verified = verifyActionToken(token);
  if (!verified.ok) {
    const problem = PROBLEMS[verified.reason] || PROBLEMS.bad_signature;
    return page(res, verified.reason === 'expired' ? 410 : 400, renderActionPage({ tone: 'stop', ...problem }));
  }

  const { thread_id: threadId, action } = verified;
  const meta = actionMeta(action);

  // Read-only actions render and stop. Nothing on the file moves, so this is
  // the one thing a link scanner may safely follow.
  if (meta.view) {
    try {
      return page(res, 200, renderOrderForm(await buildOrderForm(threadId)));
    } catch (e) {
      return page(res, 500, renderActionPage({
        title: 'Could not build the order',
        tone: 'stop',
        message: 'I could not put the order form together just now.',
        detail: String((e && e.message) || e).slice(0, 200),
      }));
    }
  }

  // High-stakes actions get an interstitial, and the ones that need Larry to
  // type something get their fields here. Either way the GET changes nothing.
  if (req.method === 'GET' && meta.confirm) {
    const asks = meta.inputs && meta.inputs.length;
    return page(res, 200, renderActionPage({
      title: meta.label,
      tone: meta.tone,
      message: meta.blurb,
      detail: asks ? '' : 'Confirm below and I will take it from here.',
      confirm: {
        url: `/api/laura-action?token=${encodeURIComponent(token)}`,
        label: asks ? meta.label : `Yes — ${meta.label.toLowerCase()}`,
        inputs: meta.inputs || null,
      },
    }));
  }

  // A blank required field means the browser validation was bypassed. Re-offer
  // the form rather than recording an action with nothing in it.
  const missingField = (meta.inputs || []).find((field) => field.required && !String(body[field.name] || '').trim());
  if (missingField) {
    return page(res, 400, renderActionPage({
      title: meta.label,
      tone: 'neutral',
      message: `I still need the ${missingField.label.toLowerCase()}. Nothing has been saved.`,
      confirm: {
        url: `/api/laura-action?token=${encodeURIComponent(token)}`,
        label: meta.label,
        inputs: meta.inputs,
      },
    }));
  }

  try {
    const result = await performLarryAction(threadId, action, { value: body.value });
    return page(res, 200, renderActionPage({
      title: result.title,
      message: result.message,
      detail: result.detail || '',
      tone: result.tone || 'go',
    }));
  } catch (e) {
    return page(res, 500, renderActionPage({
      title: 'Something went wrong',
      tone: 'stop',
      message: 'I could not complete that just now, and nothing was changed.',
      detail: String((e && e.message) || e).slice(0, 200),
    }));
  }
}
