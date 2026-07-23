import crypto from 'node:crypto';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const THREAD_TOKEN_BYTES = 4;

function env(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim();
}

function trim(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/);
  const email = match ? match[1] : raw.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/)?.[0];
  return String(email || '').toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function config() {
  return {
    supabaseUrl: env('SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseKey: env('SUPABASE_SERVICE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
    anthropicKey: env('ANTROPIC_API_KEY', process.env.ANTHROPIC_API_KEY || process.env.VillageServerChatBotAnthropicKey),
    resendKey: env('RESEND_API_KEY_AGENT', process.env.RESEND_API_KEY),
    agentEmail: env('AGENT_EMAIL', 'villageserverassistant@gmail.com'),
    agentName: env('AGENT_NAME', 'Laura'),
    larryEmail: env('LARRY_EMAIL', 'larry.villageserver@gmail.com'),
    fromEmail: env('CONTACT_FROM_EMAIL', 'VillageServer Initiative <onboarding@resend.dev>'),
    notifyEmail: env('NOTIFY_EMAIL', 'villageserverinitiative@gmail.com'),
    model: env('INTAKE_AGENT_MODEL', DEFAULT_MODEL),
    calBookingUrl: env('LARRY_CAL_BOOKING_URL', process.env.CAL_BOOKING_URL),
    emailProvider: env('EMAIL_PROVIDER', 'resend').toLowerCase(),
    gmailUser: env('GMAIL_USER', 'me'),
  };
}

function requireSupabase() {
  const c = config();
  if (!c.supabaseUrl || !c.supabaseKey) throw new Error('Supabase is not configured.');
  return c;
}

function sbHeaders(c, extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: c.supabaseKey,
    Authorization: `Bearer ${c.supabaseKey}`,
    ...extra,
  };
}

async function sbFetch(path, options = {}) {
  const c = requireSupabase();
  const response = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: sbHeaders(c, options.headers || {}),
    cache: 'no-store',
  });
  return response;
}

async function sbJson(path, options = {}) {
  const response = await sbFetch(path, options);
  if (!response.ok && response.status !== 206) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json().catch(() => null);
}

async function selectRows(tableAndQuery) {
  const rows = await sbJson(tableAndQuery);
  return Array.isArray(rows) ? rows : [];
}

async function insertRow(table, row) {
  const rows = await sbJson(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function patchRows(tableAndQuery, patch) {
  const rows = await sbJson(tableAndQuery, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows : [];
}

async function getSetting(key, fallback = null) {
  try {
    const rows = await selectRows(`site_settings?select=value&key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows.length ? rows[0].value : fallback;
  } catch (e) {
    return fallback;
  }
}

async function settingBool(key, fallback = false) {
  const value = await getSetting(key, fallback);
  return value === true || value === 'true';
}

function newThreadToken() {
  return crypto.randomBytes(THREAD_TOKEN_BYTES).toString('hex').toUpperCase();
}

function parseJsonDecision(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (inner) { return null; }
  }
}

function kitLabel(app) {
  const labels = {
    1: 'Tier 1 - microSD card',
    2: 'Tier 2 - Wi-Fi sharing hub',
    3: 'Tier 3 - Raspberry Pi VillageServer',
    4: 'Tier 4 - Projector and audio',
    5: 'Tier 5 - Satellite receive-and-replay',
  };
  return labels[Number(app && app.kit_tier)] || 'No tier selected';
}

function appSummaryLines(app) {
  const phone = [app.phone_country_code, app.phone].filter(Boolean).join(' ');
  return [
    `Name: ${app.name || ''}`,
    `Email: ${app.email || ''}`,
    `Phone: ${phone || ''}`,
    `Organization: ${app.organization || ''}`,
    `Role: ${app.role || ''}`,
    `Country/region: ${[app.country, app.region].filter(Boolean).join(', ')}`,
    `Requested kit: ${kitLabel(app)}`,
    `Audience: ${[app.audience_type, app.frequency_of_use].filter(Boolean).join(' / ')}`,
    `Reach plan: ${app.reach_justification || ''}`,
    `Gathering infrastructure: ${app.has_gathering_infrastructure == null ? '' : app.has_gathering_infrastructure ? `Yes - ${app.gathering_infrastructure_desc || ''}` : 'Not yet'}`,
    `Languages: ${app.languages || ''}`,
    `Literacy context: ${app.literacy_context || ''}`,
    `Power/internet: ${app.power_internet_access || ''}`,
    `Website: ${app.org_website || ''}`,
    `Sending org: ${app.sending_org || ''}`,
    `Reference: ${[app.reference_name, app.reference_contact].filter(Boolean).join(' - ')}`,
    `Years in field: ${app.years_in_field || ''}`,
    `Current reach: ${app.current_reach || ''}`,
    `Receiving plan: ${[app.receiving_plan, app.receiving_plan_details].filter(Boolean).join(' - ')}`,
    `Shipping address / delivery destination: ${app.shipping_address || ''}`,
    `Funding requested: ${app.funding_needed || ''}`,
    `Timeframe: ${app.timeframe || ''}`,
    `Preferred contact: ${[app.preferred_contact_method, app.contact_timezone].filter(Boolean).join(' / ')}`,
    `Mission context: ${app.mission_context || ''}`,
    `Message: ${app.message || ''}`,
    `Triage: ${app.triage_confidence || ''} ${app.triage_score != null ? `${app.triage_score}/3` : ''}`,
    `Triage note: ${app.triage_note || ''}`,
  ];
}

function detectMissingFields(app) {
  const missing = [];
  if (!app.reference_name || !app.reference_contact) missing.push('reference contact');
  if (!app.org_website && !app.sending_org) missing.push('organization website or sending organization');
  if (!app.power_internet_access) missing.push('power and internet access');
  if (!app.languages) missing.push('languages needed');
  if (!app.receiving_plan) missing.push('receiving/shipping plan');
  if (['transport_partner', 'approved_retailer', 'alternative_plan', 'need_help'].includes(String(app.receiving_plan || '')) && !app.receiving_plan_details) {
    missing.push('receiving plan details');
  }
  if (['cover_import_costs', 'transport_partner', 'alternative_plan'].includes(String(app.receiving_plan || '')) && !app.shipping_address) {
    missing.push('shipping address or delivery destination');
  }
  if (!app.preferred_contact_method) missing.push('preferred contact method');
  return missing.slice(0, 6);
}

function latestMessage(messages, role) {
  return asArray(messages).filter((m) => m.role === role).slice(-1)[0] || null;
}

function fallbackDecision(app, thread, messages) {
  const missing = detectMissingFields(app);
  const lastLarry = latestMessage(messages, 'larry');
  if (lastLarry) {
    return {
      next_action: 'reply_customer',
      state: 'waiting_on_customer',
      audience: 'applicant',
      missing_fields: missing,
      summary: `Larry replied. Laura should continue the applicant conversation for ${app.name || 'this applicant'}.`,
      draft_subject: `VillageServer application update [VS-${thread.thread_token}]`,
      draft_body: [
        `Hi ${app.name || 'there'},`,
        '',
        `Thanks for your patience. I checked with Larry and wanted to follow up on your VillageServer application.`,
        '',
        `Could you reply with any final details, photos, shipping notes, or timing concerns that would help us prepare the next step?`,
        '',
        `${config().agentName}`,
        `VillageServer Initiative`,
      ].join('\n'),
      reasoning: 'Fallback draft because Anthropic is not configured or returned invalid JSON.',
      auto_send_ok: false,
    };
  }
  if (missing.length) {
    return {
      next_action: 'ask_customer',
      state: 'waiting_on_customer',
      audience: 'applicant',
      missing_fields: missing,
      summary: `${app.name || 'Applicant'} needs ${missing.join(', ')} before Larry can make a clean decision.`,
      draft_subject: `A few details for your VillageServer application [VS-${thread.thread_token}]`,
      draft_body: [
        `Hi ${app.name || 'there'},`,
        '',
        `Thank you for your VillageServer application. I am helping Larry organize the intake queue and want to make sure he has the right details before review.`,
        '',
        `Could you reply with:`,
        ...missing.map((field) => `- ${field}`),
        '',
        `Once I have those, I will keep your application moving.`,
        '',
        `${config().agentName}`,
        `VillageServer Initiative`,
      ].join('\n'),
      reasoning: 'Missing operational details.',
      auto_send_ok: true,
    };
  }
  return {
    next_action: 'ask_larry',
    state: 'waiting_on_larry',
    audience: 'larry',
    missing_fields: [],
    summary: `${app.name || 'Applicant'} appears ready for Larry review.`,
    draft_subject: `Laura review needed: ${app.name || 'new applicant'} [VS-${thread.thread_token}]`,
    draft_body: [
      `Larry,`,
      '',
      `This application looks complete enough for your decision.`,
      '',
      appSummaryLines(app).filter((line) => !line.endsWith(': ')).join('\n'),
      '',
      `Reply with the token VS-${thread.thread_token} and what you want me to do next, such as:`,
      `- send the scheduling link`,
      `- ask for one more detail`,
      `- approve and file deployment`,
      `- waitlist or decline`,
      '',
      `${config().agentName}`,
    ].join('\n'),
    reasoning: 'Application has the basic operating information.',
    auto_send_ok: false,
  };
}

function normalizeDecision(decision, app, thread, messages) {
  const fallback = fallbackDecision(app, thread, messages);
  const d = decision && typeof decision === 'object' ? decision : fallback;
  const nextAction = String(d.next_action || fallback.next_action);
  const safeActions = new Set([
    'ask_customer', 'ask_larry', 'reply_customer', 'send_schedule_link',
    'file_deployment', 'request_rollout_photos', 'close', 'escalate',
  ]);
  const action = safeActions.has(nextAction) ? nextAction : fallback.next_action;
  const audience = ['applicant', 'larry', 'internal'].includes(String(d.audience || '')) ? String(d.audience) : fallback.audience;
  return {
    next_action: action,
    state: trim(d.state || fallback.state, 80) || fallback.state,
    audience,
    missing_fields: Array.isArray(d.missing_fields) ? d.missing_fields.map((x) => trim(x, 120)).filter(Boolean).slice(0, 8) : fallback.missing_fields,
    summary: trim(d.summary || fallback.summary, 1000),
    draft_subject: trim(d.draft_subject || fallback.draft_subject, 220),
    draft_body: trim(d.draft_body || fallback.draft_body, 6000),
    reasoning: trim(d.reasoning || fallback.reasoning, 1000),
    auto_send_ok: Boolean(d.auto_send_ok),
    filing: d.filing && typeof d.filing === 'object' ? d.filing : null,
  };
}

async function callAnthropicDecision({ app, thread, messages }) {
  const c = config();
  if (!c.anthropicKey) return fallbackDecision(app, thread, messages);
  const missing = detectMissingFields(app);
  const history = asArray(messages).slice(-12).map((m) => ({
    role: m.role,
    status: m.status,
    subject: m.subject || '',
    body: trim(m.body, 1800),
    created_at: m.created_at,
  }));
  const system = [
    `You are ${c.agentName}, the VillageServer backend receptionist.`,
    `Your job is to keep form-fillout applicants moving toward one of these outcomes: missing-info collected, Larry decision requested, scheduling link sent, deployment filed, shipping/update followed up, rollout photos requested, or closed.`,
    `Never promise equipment, funding, discounts, delivery dates, shipment dates, or approvals unless Larry explicitly said so in the conversation history.`,
    `If Larry has replied with a concrete instruction, draft the customer-facing follow-up that carries out that instruction.`,
    `If the applicant is missing routine details, ask for only the important missing details in a warm short email.`,
    `If ready for a call and a booking URL is available, send the booking URL. Booking URL: ${c.calBookingUrl || 'not configured'}.`,
    `Escalate to Larry for complaints, money disputes, safety concerns, unclear shipping promises, custom pricing, or anything sensitive.`,
    `Do not use markdown headings. Email copy should be plain, concise, and human.`,
    `Return ONLY valid JSON with this shape: {"next_action":"ask_customer|ask_larry|reply_customer|send_schedule_link|file_deployment|request_rollout_photos|close|escalate","state":"waiting_on_customer|waiting_on_larry|ready_to_schedule|scheduled|ready_to_ship|shipped|follow_up_photos|filed|closed|escalated","audience":"applicant|larry|internal","missing_fields":["..."],"summary":"one internal sentence","draft_subject":"...","draft_body":"...","reasoning":"one internal sentence","auto_send_ok":false,"filing":{"title":"","detail":"","item_type":"deployment|campaign|shipping|photo_request|follow_up|note"}}`,
  ].join('\n');
  const user = [
    `Thread token: VS-${thread.thread_token}`,
    `Application:`,
    appSummaryLines(app).join('\n'),
    '',
    `Detected missing fields: ${missing.length ? missing.join(', ') : 'none'}`,
    '',
    `Recent conversation:`,
    JSON.stringify(history, null, 2),
  ].join('\n');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': c.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic ${response.status}: ${body.slice(0, 240)}`);
  }
  const data = await response.json();
  const text = asArray(data.content).filter((c0) => c0.type === 'text').map((c0) => c0.text).join('\n');
  return parseJsonDecision(text) || fallbackDecision(app, thread, messages);
}

async function loadApplication(applicationId) {
  const rows = await selectRows(`equipment_applications?select=*&id=eq.${encodeURIComponent(String(applicationId))}&limit=1`);
  return rows[0] || null;
}

async function loadThreadBy({ threadId, applicationId, token, email }) {
  if (threadId) {
    const rows = await selectRows(`intake_threads?select=*&id=eq.${encodeURIComponent(String(threadId))}&limit=1`);
    return rows[0] || null;
  }
  if (applicationId) {
    const rows = await selectRows(`intake_threads?select=*&application_id=eq.${encodeURIComponent(String(applicationId))}&limit=1`);
    return rows[0] || null;
  }
  if (token) {
    const rows = await selectRows(`intake_threads?select=*&thread_token=eq.${encodeURIComponent(String(token).toUpperCase())}&limit=1`);
    return rows[0] || null;
  }
  if (email) {
    const rows = await selectRows(`intake_threads?select=*&applicant_email=eq.${encodeURIComponent(normalizeEmail(email))}&order=updated_at.desc&limit=1`);
    return rows[0] || null;
  }
  return null;
}

export async function ensureThreadForApplication(applicationId, appRow = null) {
  const app = appRow || await loadApplication(applicationId);
  if (!app) throw new Error('Application not found.');
  const existing = await loadThreadBy({ applicationId: app.id || applicationId });
  if (existing) return existing;
  let token = newThreadToken();
  for (let i = 0; i < 3; i += 1) {
    try {
      return await insertRow('intake_threads', {
        application_id: String(app.id || applicationId),
        thread_token: token,
        applicant_name: trim(app.name, 160) || null,
        applicant_email: normalizeEmail(app.email) || null,
        state: 'new',
        owner: 'laura',
        summary: `New application from ${app.name || 'applicant'} in ${app.country || 'unknown country'}.`,
        missing_fields: detectMissingFields(app),
      });
    } catch (e) {
      token = newThreadToken();
      if (i === 2) throw e;
    }
  }
  return null;
}

async function messagesForThread(threadId) {
  if (!threadId) return [];
  return selectRows(`intake_messages?select=*&thread_id=eq.${encodeURIComponent(String(threadId))}&order=created_at.asc`);
}

async function latestDraftForThread(threadId) {
  const rows = await selectRows(`intake_messages?select=*&thread_id=eq.${encodeURIComponent(String(threadId))}&status=eq.draft&direction=eq.outbound&order=created_at.desc&limit=1`);
  return rows[0] || null;
}

async function createMessage(row) {
  return insertRow('intake_messages', {
    thread_id: row.thread_id || null,
    role: row.role || 'agent',
    channel: row.channel || 'email',
    direction: row.direction || 'internal',
    action_type: row.action_type || null,
    subject: trim(row.subject, 240) || null,
    body: trim(row.body, 8000) || null,
    from_email: normalizeEmail(row.from_email) || null,
    to_email: Array.isArray(row.to_email) ? row.to_email.map(normalizeEmail).filter(Boolean) : [],
    status: row.status || 'draft',
    provider: row.provider || null,
    provider_message_id: row.provider_message_id || null,
    gmail_message_id: row.gmail_message_id || null,
    metadata: row.metadata || {},
    sent_at: row.sent_at || null,
  });
}

function defaultSubjectFor(decision, app, thread) {
  const token = `[VS-${thread.thread_token}]`;
  if (decision.next_action === 'ask_larry') return `Laura review needed: ${app.name || 'new applicant'} ${token}`;
  if (decision.next_action === 'send_schedule_link') return `Schedule a VillageServer call ${token}`;
  if (decision.next_action === 'request_rollout_photos') return `VillageServer rollout photos ${token}`;
  return `Your VillageServer application ${token}`;
}

function subjectWithToken(subject, thread) {
  const token = `[VS-${thread.thread_token}]`;
  const s = trim(subject, 220) || `VillageServer update ${token}`;
  return new RegExp(`VS[-:]?${thread.thread_token}`, 'i').test(s) ? s : `${s} ${token}`;
}

function audienceToEmail(audience, app) {
  const c = config();
  if (audience === 'larry') return c.larryEmail;
  if (audience === 'applicant') return normalizeEmail(app.email);
  return '';
}

export async function runLauraAgent({ threadId = '', applicationId = '', autoSend = false, reason = 'manual' } = {}) {
  if (!(await settingBool('laura_agent_enabled', true))) {
    return { ok: false, skipped: true, reason: 'Laura agent is disabled.' };
  }
  let thread = await loadThreadBy({ threadId, applicationId });
  let app = thread ? await loadApplication(thread.application_id) : null;
  if (!thread && applicationId) {
    app = await loadApplication(applicationId);
    thread = await ensureThreadForApplication(applicationId, app);
  }
  if (!thread || !app) throw new Error('Thread or application not found.');
  const messages = await messagesForThread(thread.id);
  let rawDecision;
  try {
    rawDecision = await callAnthropicDecision({ app, thread, messages });
  } catch (e) {
    rawDecision = fallbackDecision(app, thread, messages);
    rawDecision.reasoning = `${rawDecision.reasoning} Anthropic failed: ${String((e && e.message) || e).slice(0, 180)}`;
  }
  const decision = normalizeDecision(rawDecision, app, thread, messages);
  const to = audienceToEmail(decision.audience, app);
  const outbound = decision.audience === 'applicant' || decision.audience === 'larry';
  const subject = subjectWithToken(decision.draft_subject || defaultSubjectFor(decision, app, thread), thread);
  const message = await createMessage({
    thread_id: thread.id,
    role: 'agent',
    channel: 'email',
    direction: outbound ? 'outbound' : 'internal',
    action_type: decision.next_action,
    subject,
    body: decision.draft_body,
    from_email: config().agentEmail,
    to_email: to ? [to] : [],
    status: outbound ? 'draft' : 'note',
    metadata: {
      decision,
      reason,
      reasoning: decision.reasoning,
      model: config().anthropicKey ? config().model : 'fallback',
    },
  });
  await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
    state: decision.state,
    owner: decision.audience === 'larry' ? 'larry' : decision.audience === 'applicant' ? 'applicant' : 'laura',
    summary: decision.summary || thread.summary || null,
    missing_fields: decision.missing_fields || [],
    last_agent_run_at: new Date().toISOString(),
    digest_pending: true,
  });
  if (decision.filing && decision.filing.title) {
    await insertRow('agent_filing_items', {
      thread_id: thread.id,
      application_id: String(app.id),
      item_type: trim(decision.filing.item_type, 80) || 'note',
      title: trim(decision.filing.title, 220),
      detail: trim(decision.filing.detail, 2000) || null,
      state: 'pending',
      metadata: { source_message_id: message && message.id, decision_action: decision.next_action },
    }).catch(() => null);
  }
  let sent = null;
  const autoMissingInfo = await settingBool('laura_auto_send_missing_info', false);
  const allowAutoSend = outbound && autoSend && decision.auto_send_ok &&
    ((decision.next_action === 'ask_customer' && autoMissingInfo) ||
      (decision.next_action === 'reply_customer' && env('LAURA_AUTO_SEND_AFTER_LARRY') === 'true') ||
      (decision.next_action === 'send_schedule_link' && env('LAURA_AUTO_SEND_SCHEDULING') === 'true'));
  if (message && allowAutoSend) sent = await sendMessageById(message.id);
  return { ok: true, thread_id: thread.id, application_id: app.id, decision, message, sent };
}

export async function listLauraThreads({ includeMessages = false, limit = 80 } = {}) {
  const threads = await selectRows(`intake_threads?select=*&order=updated_at.desc&limit=${Number(limit) || 80}`);
  if (!includeMessages || !threads.length) return { threads, messages: [], filing_items: [] };
  const threadIds = threads.map((t) => t.id);
  const messages = await selectRows(`intake_messages?select=*&order=created_at.asc&limit=500`);
  const filingItems = await selectRows(`agent_filing_items?select=*&order=created_at.desc&limit=300`);
  const allowed = new Set(threadIds);
  return {
    threads,
    messages: messages.filter((m) => !m.thread_id || allowed.has(m.thread_id)),
    filing_items: filingItems.filter((m) => !m.thread_id || allowed.has(m.thread_id)),
  };
}

export async function ensureThreadsForRecentApplications({ limit = 30 } = {}) {
  const apps = await selectRows(`equipment_applications?select=*&order=created_at.desc&limit=${Number(limit) || 30}`);
  const made = [];
  for (const app of apps) {
    try {
      made.push(await ensureThreadForApplication(app.id, app));
    } catch (e) {
      made.push({ application_id: app.id, error: String(e.message || e) });
    }
  }
  return made;
}

async function sendResendEmail({ to, subject, text, replyTo }) {
  const c = config();
  if (!c.resendKey) throw new Error('RESEND_API_KEY_AGENT or RESEND_API_KEY is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.resendKey}` },
    body: JSON.stringify({
      from: c.fromEmail,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo || c.agentEmail,
      subject,
      text,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Resend ${response.status}`);
  return { provider: 'resend', provider_message_id: body.id || null };
}

function base64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function gmailAccessToken() {
  const clientId = env('GMAIL_CLIENT_ID');
  const clientSecret = env('GMAIL_CLIENT_SECRET');
  const refreshToken = env('GMAIL_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Gmail OAuth is not configured.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || `Gmail token ${response.status}`);
  return body.access_token;
}

async function sendGmailEmail({ to, subject, text, replyTo }) {
  const c = config();
  const token = await gmailAccessToken();
  const recipient = Array.isArray(to) ? to.join(', ') : to;
  const raw = [
    `From: ${c.agentName} <${c.agentEmail}>`,
    `To: ${recipient}`,
    `Reply-To: ${replyTo || c.agentEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].join('\r\n');
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(c.gmailUser)}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ raw: base64Url(raw) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Gmail send ${response.status}`);
  return { provider: 'gmail', provider_message_id: body.id || null, gmail_thread_id: body.threadId || null };
}

async function sendEmail({ to, subject, text, replyTo }) {
  const c = config();
  if (c.emailProvider === 'gmail') return sendGmailEmail({ to, subject, text, replyTo });
  return sendResendEmail({ to, subject, text, replyTo });
}

export async function sendMessageById(messageId) {
  const rows = await selectRows(`intake_messages?select=*&id=eq.${encodeURIComponent(String(messageId))}&limit=1`);
  const message = rows[0];
  if (!message) throw new Error('Draft not found.');
  if (message.status === 'sent') return { already_sent: true, message };
  if (message.direction !== 'outbound') throw new Error('Only outbound drafts can be sent.');
  const to = asArray(message.to_email).map(normalizeEmail).filter(Boolean);
  if (!to.length) throw new Error('Draft has no recipient.');
  const sent = await sendEmail({ to, subject: message.subject, text: message.body, replyTo: config().agentEmail });
  const patched = await patchRows(`intake_messages?id=eq.${encodeURIComponent(message.id)}`, {
    status: 'sent',
    provider: sent.provider,
    provider_message_id: sent.provider_message_id,
    sent_at: new Date().toISOString(),
    metadata: { ...(message.metadata || {}), sent },
  });
  if (message.thread_id) {
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(message.thread_id)}`, {
      digest_pending: true,
      gmail_thread_id: sent.gmail_thread_id || undefined,
    }).catch(() => null);
  }
  return { sent, message: patched[0] || message };
}

export async function sendLauraDigest({ force = false } = {}) {
  const c = config();
  const rows = await selectRows('intake_threads?select=*&order=updated_at.desc&limit=80');
  const activeStates = new Set(['new', 'waiting_on_larry', 'waiting_on_customer', 'ready_to_schedule', 'ready_to_ship', 'follow_up_photos', 'escalated']);
  const threads = rows.filter((t) => force || t.digest_pending || activeStates.has(t.state)).slice(0, 25);
  if (!threads.length) return { ok: true, sent: false, reason: 'No active Laura threads.' };
  const allMessages = await selectRows('intake_messages?select=*&order=created_at.desc&limit=500');
  const allTasks = await selectRows('agent_filing_items?select=*&state=eq.pending&order=created_at.desc&limit=200').catch(() => []);
  const byThread = new Map();
  allMessages.forEach((m) => {
    if (!m.thread_id) return;
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id).push(m);
  });
  const taskByThread = new Map();
  asArray(allTasks).forEach((task) => {
    if (!task.thread_id) return;
    if (!taskByThread.has(task.thread_id)) taskByThread.set(task.thread_id, []);
    taskByThread.get(task.thread_id).push(task);
  });
  const body = [
    `Larry,`,
    '',
    `Laura intake digest: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`,
    '',
    `Reply with the VS token when you want me to act. Example: "VS-AB12CD34 approve and send scheduling link" or "VS-AB12CD34 shipped UPS tracking 1Z..."`,
    '',
    ...threads.flatMap((t, index) => {
      const recent = (byThread.get(t.id) || []).slice(0, 2).reverse();
      const tasks = taskByThread.get(t.id) || [];
      return [
        `${index + 1}. ${t.applicant_name || 'Applicant'} <${t.applicant_email || 'no email'}> - VS-${t.thread_token}`,
        `State: ${t.state} / owner: ${t.owner}`,
        `Summary: ${t.summary || 'No summary yet.'}`,
        `Missing: ${asArray(t.missing_fields).join(', ') || 'none'}`,
        tasks.length ? `Filing/tasks: ${tasks.map((task) => task.title).join('; ')}` : '',
        recent.length ? `Recent: ${recent.map((m) => `${m.role}: ${trim(m.body, 180).replace(/\s+/g, ' ')}`).join(' | ')}` : '',
        '',
      ].filter(Boolean);
    }),
    `${c.agentName}`,
  ].join('\n');
  const subject = `Laura digest - ${threads.length} active intake ${threads.length === 1 ? 'thread' : 'threads'}`;
  const sent = await sendEmail({ to: c.larryEmail, subject, text: body, replyTo: c.agentEmail });
  const digest = await insertRow('agent_digests', {
    digest_key: crypto.randomUUID(),
    sent_to: c.larryEmail,
    thread_ids: threads.map((t) => t.id),
    subject,
    body,
    status: 'sent',
    provider: sent.provider,
    provider_message_id: sent.provider_message_id,
    sent_at: new Date().toISOString(),
  });
  await Promise.all(threads.map((t) => patchRows(`intake_threads?id=eq.${encodeURIComponent(t.id)}`, {
    digest_pending: false,
    digest_last_sent_at: new Date().toISOString(),
  }).catch(() => null)));
  return { ok: true, sent: true, digest, count: threads.length };
}

function extractThreadToken(subject, body) {
  const haystack = `${subject || ''}\n${body || ''}`;
  const match = haystack.match(/\bVS[-:\s]?([A-F0-9]{8})\b/i);
  return match ? match[1].toUpperCase() : '';
}

function decodeGmailBase64(data) {
  if (!data) return '';
  const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function findGmailPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body && payload.body.data) return payload;
  for (const part of asArray(payload.parts)) {
    const found = findGmailPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

function parseGmailPayload(message) {
  const headers = asArray(message.payload?.headers);
  const header = (name) => headers.find((h) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
  const plain = findGmailPart(message.payload, 'text/plain');
  const html = findGmailPart(message.payload, 'text/html');
  const body = plain ? decodeGmailBase64(plain.body.data)
    : html ? decodeGmailBase64(html.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : decodeGmailBase64(message.payload?.body?.data || '');
  return {
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    from_email: normalizeEmail(header('From')),
    subject: trim(header('Subject'), 240),
    body: trim(body || message.snippet || '', 8000),
    message_id_header: header('Message-ID'),
  };
}

async function gmailRequest(path, options = {}) {
  const c = config();
  const token = await gmailAccessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(c.gmailUser)}/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Gmail ${response.status}`);
  return body;
}

async function findThreadForInbound(parsed) {
  const token = extractThreadToken(parsed.subject, parsed.body);
  if (token) {
    const thread = await loadThreadBy({ token });
    if (thread) return thread;
  }
  const sender = normalizeEmail(parsed.from_email);
  if (sender && sender !== normalizeEmail(config().larryEmail)) {
    const thread = await loadThreadBy({ email: sender });
    if (thread) return thread;
  }
  return null;
}

export async function pollGmailInbox({ limit = 10, autoRun = true } = {}) {
  if (!env('GMAIL_CLIENT_ID') || !env('GMAIL_CLIENT_SECRET') || !env('GMAIL_REFRESH_TOKEN')) {
    return { ok: true, configured: false, processed: 0, message: 'Gmail OAuth env vars are not configured yet.' };
  }
  const listed = await gmailRequest(`messages?maxResults=${Number(limit) || 10}&q=${encodeURIComponent('in:inbox is:unread newer_than:14d')}`);
  const messages = asArray(listed.messages).slice(0, Number(limit) || 10);
  let processed = 0;
  const results = [];
  for (const item of messages) {
    const raw = await gmailRequest(`messages/${encodeURIComponent(item.id)}?format=full`);
    const parsed = parseGmailPayload(raw);
    const existing = await selectRows(`intake_messages?select=id&gmail_message_id=eq.${encodeURIComponent(parsed.gmail_message_id)}&limit=1`);
    if (existing.length) {
      await gmailRequest(`messages/${encodeURIComponent(item.id)}/modify`, {
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      }).catch(() => null);
      continue;
    }
    const thread = await findThreadForInbound(parsed);
    const fromLarry = normalizeEmail(parsed.from_email) === normalizeEmail(config().larryEmail);
    const message = await createMessage({
      thread_id: thread && thread.id,
      role: fromLarry ? 'larry' : 'applicant',
      channel: 'gmail',
      direction: 'inbound',
      action_type: fromLarry ? 'larry_instruction' : 'customer_reply',
      subject: parsed.subject,
      body: parsed.body,
      from_email: parsed.from_email,
      to_email: [config().agentEmail],
      status: thread ? 'received' : 'unmatched',
      provider: 'gmail',
      gmail_message_id: parsed.gmail_message_id,
      provider_message_id: parsed.message_id_header || parsed.gmail_message_id,
      metadata: { gmail_thread_id: parsed.gmail_thread_id },
    });
    if (thread) {
      await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
        owner: fromLarry ? 'laura' : 'laura',
        digest_pending: true,
        gmail_thread_id: parsed.gmail_thread_id || thread.gmail_thread_id || null,
        last_customer_message_at: fromLarry ? thread.last_customer_message_at : new Date().toISOString(),
        last_larry_message_at: fromLarry ? new Date().toISOString() : thread.last_larry_message_at,
      });
      if (autoRun) {
        const autoSend = fromLarry ? env('LAURA_AUTO_SEND_AFTER_LARRY') === 'true' : await settingBool('laura_auto_send_missing_info', false);
        await runLauraAgent({ threadId: thread.id, autoSend, reason: fromLarry ? 'larry_reply' : 'customer_reply' }).catch((e) => ({ error: e.message }));
      }
    }
    await gmailRequest(`messages/${encodeURIComponent(item.id)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    }).catch(() => null);
    processed += 1;
    results.push({ message_id: message && message.id, thread_id: thread && thread.id, matched: !!thread, from: parsed.from_email });
  }
  return { ok: true, configured: true, processed, results };
}

export async function fileDeploymentForThread(threadId) {
  const thread = await loadThreadBy({ threadId });
  if (!thread) throw new Error('Thread not found.');
  const app = await loadApplication(thread.application_id);
  if (!app) throw new Error('Application not found.');
  const existing = await selectRows(`deployments?select=id&application_id=eq.${encodeURIComponent(String(app.id))}&limit=1`).catch(() => []);
  if (existing.length) return { ok: true, already_exists: true, deployment_id: existing[0].id };
  const phone = [app.phone_country_code, app.phone].filter(Boolean).join(' ');
  const row = {
    application_id: String(app.id),
    name: trim(app.name, 240) || 'VillageServer applicant',
    contact_information: [app.email, phone].filter(Boolean).join(' / ') || null,
    country: trim(app.country, 160) || null,
    region_village: trim(app.region, 240) || null,
    additional_notes: [
      `Filed by Laura from application ${app.id}.`,
      thread.summary ? `Thread summary: ${thread.summary}` : '',
      `Requested kit: ${kitLabel(app)}`,
      app.receiving_plan ? `Receiving plan: ${app.receiving_plan}${app.receiving_plan_details ? ` - ${app.receiving_plan_details}` : ''}` : '',
      app.shipping_address ? `Shipping address / delivery destination: ${app.shipping_address}` : '',
      app.timeframe ? `Timeframe: ${app.timeframe}` : '',
      app.message ? `Applicant message: ${app.message}` : '',
    ].filter(Boolean).join('\n'),
    follow_up_needed: 'Laura should follow up for rollout pictures, initiative photos, and field notes after deployment.',
  };
  const deployment = await insertRow('deployments', row);
  await insertRow('agent_filing_items', {
    thread_id: thread.id,
    application_id: String(app.id),
    item_type: 'deployment',
    state: 'done',
    title: `Deployment filed for ${app.name || 'applicant'}`,
    detail: `Created deployment record ${deployment && deployment.id ? deployment.id : ''}`.trim(),
    completed_at: new Date().toISOString(),
    metadata: { deployment_id: deployment && deployment.id },
  }).catch(() => null);
  await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
    state: 'filed',
    owner: 'filing',
    digest_pending: true,
  }).catch(() => null);
  return { ok: true, deployment };
}

export async function intakeHealth() {
  const c = config();
  return {
    supabase_configured: !!(c.supabaseUrl && c.supabaseKey),
    anthropic_configured: !!c.anthropicKey,
    resend_configured: !!c.resendKey,
    gmail_oauth_configured: !!(env('GMAIL_CLIENT_ID') && env('GMAIL_CLIENT_SECRET') && env('GMAIL_REFRESH_TOKEN')),
    email_provider: c.emailProvider,
    agent_email: c.agentEmail,
    larry_email: c.larryEmail,
    cal_booking_configured: !!c.calBookingUrl,
  };
}
