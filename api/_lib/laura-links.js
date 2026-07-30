// Signed one-click action links for Larry's intake emails.
//
// Larry acts on an application straight from his inbox. Each button in the
// email carries a signed, expiring token that names exactly one thread and one
// action, so a link can never be edited into a different decision.
//
// Deliberately dependency-free: both the agent core (which builds links) and
// the /api/laura-action endpoint (which verifies them) import this, and neither
// should end up importing the other.
//
// Token: base64url("v1.<expiry-ms>.<thread-id>.<action>.<hmac-sha256-hex-32>")
import crypto from 'node:crypto';

const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_DAYS = 14;
const SIGNATURE_CHARS = 32; // 128 bits of a sha256 hex digest

// `confirm: true` means a click only opens a confirmation page; the action
// itself needs a POST from that page. Mail scanners and link prefetchers follow
// GETs, and no scanner should be able to approve or decline an application.
export const LARRY_ACTIONS = {
  approve: {
    label: 'Approve & send booking link',
    confirm: true,
    tone: 'go',
    blurb: 'Marks the application approved and emails the applicant the scheduling link.',
  },
  'send-draft': {
    label: 'Send Laura’s draft',
    confirm: true,
    tone: 'go',
    blurb: 'Sends the drafted reply to the applicant exactly as written.',
  },
  'more-info': {
    label: 'Ask for more info',
    confirm: false,
    tone: 'neutral',
    blurb: 'Laura writes and sends the applicant a follow-up asking for what is still missing.',
  },
  hold: {
    label: 'Hold for now',
    confirm: false,
    tone: 'neutral',
    blurb: 'Pauses this file and checks back in a week.',
  },
  decline: {
    label: 'Decline',
    confirm: true,
    tone: 'stop',
    blurb: 'Marks the application declined and drafts a kind note for you to review before it sends.',
  },

  // Shipping stage. Reached once an applicant has confirmed a language and a
  // usable address — Laura has done everything she can, and the card still has
  // to physically leave the building.
  'mark-shipped': {
    label: 'Yes — I have posted it',
    confirm: true,
    tone: 'go',
    blurb: 'Files the deployment record and tells the applicant their card is on its way.',
  },
  'file-deployment': {
    label: 'File deployment only',
    confirm: false,
    tone: 'neutral',
    blurb: 'Adds this to the deployment log without emailing the applicant.',
  },
  'schedule-call': {
    label: 'Set up a call first',
    confirm: true,
    tone: 'neutral',
    blurb: 'Sends the applicant your booking link so you can talk before anything ships.',
  },
};

// Stages where the useful question is "has this been posted yet?" rather than
// "do you approve this applicant?".
const SHIPPING_STAGES = new Set(['ready_to_ship', 'shipped', 'filed']);

export function isKnownAction(action) {
  return Object.prototype.hasOwnProperty.call(LARRY_ACTIONS, String(action || ''));
}

// While only microSD cards are going out, "approve" cannot say "booking link" —
// the button has to describe what will actually happen when it is pressed.
function sdCardOnly() {
  return String(process.env.LAURA_OFFER_MODE || 'sd_card_only').toLowerCase() !== 'full_kits';
}

export function actionMeta(action) {
  const base = LARRY_ACTIONS[action];
  if (!base) return null;
  if (action === 'approve' && sdCardOnly()) {
    return {
      ...base,
      label: 'Approve — send a card',
      blurb: 'Marks the application approved and tells the applicant a microSD card in their language is on the way.',
    };
  }
  return base;
}

function actionSecret() {
  const secret = String(process.env.LAURA_ACTION_SECRET || process.env.ADMIN_PASSWORD || '').trim();
  if (!secret) throw new Error('LAURA_ACTION_SECRET or ADMIN_PASSWORD must be set to sign action links.');
  return secret;
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function payloadOf(expiry, threadId, action) {
  return `${TOKEN_VERSION}.${expiry}.${threadId}.${action}`;
}

function sign(payload) {
  return crypto.createHmac('sha256', actionSecret()).update(payload).digest('hex').slice(0, SIGNATURE_CHARS);
}

export function signActionToken(threadId, action, { ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const id = String(threadId || '');
  const name = String(action || '');
  if (!id || !isKnownAction(name)) throw new Error('A thread id and known action are required.');
  const expiry = Date.now() + Number(ttlDays) * 24 * 60 * 60 * 1000;
  const payload = payloadOf(expiry, id, name);
  return base64UrlEncode(`${payload}.${sign(payload)}`);
}

// Returns { ok, thread_id, action, reason }. Never throws on bad input — a
// mangled link should render a friendly page, not a stack trace.
export function verifyActionToken(token) {
  let decoded = '';
  try {
    decoded = base64UrlDecode(token);
  } catch (e) {
    return { ok: false, reason: 'unreadable' };
  }
  const parts = decoded.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'unreadable' };
  const [, expiryRaw, threadId, action, given] = parts;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry)) return { ok: false, reason: 'unreadable' };
  if (!isKnownAction(action)) return { ok: false, reason: 'unreadable' };

  let expected = '';
  try {
    expected = sign(payloadOf(expiryRaw, threadId, action));
  } catch (e) {
    return { ok: false, reason: 'unconfigured' };
  }
  if (given.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))) {
    return { ok: false, reason: 'bad_signature' };
  }
  // Expiry is checked after the signature so an attacker cannot use timing on
  // the cheap check to probe for valid thread ids.
  if (expiry < Date.now()) return { ok: false, reason: 'expired', thread_id: threadId, action };
  return { ok: true, thread_id: threadId, action };
}

export function siteBaseUrl() {
  const raw = String(
    process.env.LAURA_SITE_URL
    || process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || 'https://www.villageservers.com',
  ).trim();
  return raw.replace(/\/+$/, '');
}

export function actionUrl(threadId, action) {
  return `${siteBaseUrl()}/api/laura-action?token=${encodeURIComponent(signActionToken(threadId, action))}`;
}

export function adminFileUrl(threadId) {
  return `${siteBaseUrl()}/admin.html#laura-agent/${encodeURIComponent(String(threadId || ''))}`;
}

// Every button Larry should see for a thread, already signed. `hasDraft` swaps
// the generic approve button for "send this exact draft".
export function shippingButtonNames() {
  return ['mark-shipped', 'file-deployment', 'more-info', 'schedule-call', 'hold'];
}

export function actionButtonsFor(threadId, { hasDraft = false, actions = null, stage = '' } = {}) {
  // Once the applicant has confirmed a language and an address, "approve" is a
  // decision that has already been made. What Larry needs then is a way to say
  // he has posted it.
  const names = actions || (SHIPPING_STAGES.has(String(stage))
    ? shippingButtonNames()
    // When a draft is sitting right above the buttons, sending that exact text
    // is the natural first move — it is the thing Larry has just read.
    : hasDraft
      ? ['send-draft', 'approve', 'more-info', 'hold', 'decline']
      : ['approve', 'more-info', 'hold', 'decline']);
  return names.filter(isKnownAction).map((name) => ({
    action: name,
    ...actionMeta(name),
    url: actionUrl(threadId, name),
  }));
}
