import crypto from 'node:crypto';
import {
  renderApplicantEmail,
  renderDigestEmail,
  renderLarryActionEmail,
} from './laura-email.js';
import {
  actionButtonsFor, adminFileUrl, isKnownAction, postedButtonNames, siteBaseUrl,
} from './laura-links.js';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const THREAD_TOKEN_BYTES = 4;

// Autonomy rails. Laura may send her own low-risk mail, but only inside these
// limits — one applicant email per cooldown window, and a hard cap on how many
// times she will chase someone before handing the file to Larry.
const DEFAULT_COOLDOWN_HOURS = 24;
const DEFAULT_FOLLOW_UP_DAYS = 4;
const DEFAULT_MAX_NUDGES = 3;

// Post to the places these cards go is measured in weeks, not days, so the
// "did it arrive?" note waits far longer than an intake nudge. Asking too early
// just makes someone apologise for the postal service.
const DEFAULT_ARRIVAL_CHECK_DAYS = 14;
const DEFAULT_MAX_ARRIVAL_CHECKS = 2;

// Actions Laura is trusted to send without Larry seeing them first. Everything
// absent from this set drafts and waits, no matter what the model decides.
// `offer_sd_card` belongs here because it only ever scales expectations *down* —
// the dangerous direction is promising more, and this promises less.
const SELF_SEND_ACTIONS = new Set([
  'ask_customer', 'reply_customer', 'follow_up_nudge', 'offer_sd_card', 'confirm_card',
  'request_rollout_photos',
]);

// Once a card is in the post the intake conversation is over. Nothing in the
// sd_card_only rulebook — which exists to stop Laura promising a kit she cannot
// send — should reach back into a file at this stage and re-offer or re-confirm
// something that has already physically shipped.
const POST_SHIPPING_STATES = new Set(['shipped', 'follow_up_photos', 'filed', 'closed']);

// How many times Laura will go back to an applicant who keeps replying without
// answering, before she stops and lets Larry look at it. Without this an
// autonomous loop can ping-pong indefinitely.
const DEFAULT_MAX_ASK_ROUNDS = 3;

// Columns Laura may fill in from an emailed reply. Identity, status, triage and
// admin fields are deliberately absent: she is transcribing what an applicant
// told her, not re-deciding who they are or how the office rated them.
const EXTRACTABLE_FIELDS = {
  phone: 'text',
  phone_country_code: 'text',
  organization: 'text',
  role: 'text',
  country: 'text',
  region: 'text',
  languages: 'text',
  literacy_context: 'text',
  power_internet_access: 'text',
  org_website: 'text',
  sending_org: 'text',
  reference_name: 'text',
  reference_contact: 'text',
  years_in_field: 'text',
  current_reach: 'text',
  reach_justification: 'text',
  gathering_infrastructure_desc: 'text',
  receiving_plan_details: 'text',
  shipping_address: 'text',
  timeframe: 'text',
  preferred_contact_method: 'text',
  contact_timezone: 'text',
  mission_context: 'text',
  kit_tier: 'int',
};

// What the initiative can actually put in the post today. While this is
// 'sd_card_only', no thread is ever handed to Larry as a kit or funding
// decision — once a file is complete, Laura levels with the applicant, offers
// the microSD card in their language, and collects the two things a card
// needs: language and a shipping address. Set LAURA_OFFER_MODE=full_kits when
// larger tiers are genuinely available again.
// Can Laura actually hear a reply? Inbound only exists when Gmail polling is
// wired up; without it, intake_messages never gains an applicant row.
function inboundConfigured() {
  return !!(env('GMAIL_CLIENT_ID') && env('GMAIL_CLIENT_SECRET') && env('GMAIL_REFRESH_TOKEN'));
}

function offerMode() {
  return env('LAURA_OFFER_MODE', 'sd_card_only').toLowerCase() === 'full_kits' ? 'full_kits' : 'sd_card_only';
}

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
    cooldownHours: Number(env('LAURA_SEND_COOLDOWN_HOURS', String(DEFAULT_COOLDOWN_HOURS))) || DEFAULT_COOLDOWN_HOURS,
    followUpDays: Number(env('LAURA_FOLLOW_UP_DAYS', String(DEFAULT_FOLLOW_UP_DAYS))) || DEFAULT_FOLLOW_UP_DAYS,
    maxNudges: Number(env('LAURA_MAX_NUDGES', String(DEFAULT_MAX_NUDGES))) || DEFAULT_MAX_NUDGES,
    maxAskRounds: Number(env('LAURA_MAX_ASK_ROUNDS', String(DEFAULT_MAX_ASK_ROUNDS))) || DEFAULT_MAX_ASK_ROUNDS,
    arrivalCheckDays: Number(env('LAURA_ARRIVAL_CHECK_DAYS', String(DEFAULT_ARRIVAL_CHECK_DAYS))) || DEFAULT_ARRIVAL_CHECK_DAYS,
    maxArrivalChecks: Number(env('LAURA_MAX_ARRIVAL_CHECKS', String(DEFAULT_MAX_ARRIVAL_CHECKS))) || DEFAULT_MAX_ARRIVAL_CHECKS,
  };
}

function daysFromNow(days) {
  return new Date(Date.now() + Number(days) * 86400000).toISOString();
}

// Applicants answer in prose — "my reference is Pastor Mary, mary@example.org".
// Without writing that back to the application row, every later check keeps
// reading the original blank form and Laura asks the same question forever.
// This is what makes the loop actually close.
export function sanitizeExtracted(extracted) {
  if (!extracted || typeof extracted !== 'object') return {};
  const clean = {};
  for (const [key, raw] of Object.entries(extracted)) {
    const kind = EXTRACTABLE_FIELDS[key];
    if (!kind) continue;
    if (raw == null) continue;
    if (kind === 'int') {
      const n = Number(String(raw).match(/\d+/)?.[0]);
      if (Number.isFinite(n) && n >= 1 && n <= 5) clean[key] = n;
      continue;
    }
    const text = trim(raw, 2000);
    // Guard against the model echoing its own placeholder back at us.
    if (!text || /^(unknown|n\/?a|none|not provided|tbd|null)$/i.test(text)) continue;
    clean[key] = text;
  }
  return clean;
}

// Only writes values that actually change something, and reports what moved so
// the edit is visible in the thread rather than happening invisibly.
async function applyExtracted(app, extracted) {
  const clean = sanitizeExtracted(extracted);
  const changes = {};
  for (const [key, value] of Object.entries(clean)) {
    const current = app[key];
    const currentText = current == null ? '' : String(current).trim();
    if (currentText === String(value).trim()) continue;
    changes[key] = { from: currentText || null, to: value };
  }
  if (!Object.keys(changes).length) return { applied: {}, changes: {} };

  const patch = Object.fromEntries(Object.entries(changes).map(([key, diff]) => [key, diff.to]));
  await patchRows(`equipment_applications?id=eq.${encodeURIComponent(String(app.id))}`, patch);
  Object.assign(app, patch); // so the rest of this run sees the updated file
  return { applied: patch, changes };
}

// 'staged'     — Laura sends her own info-gathering mail and nudges; anything
//                that approves, declines, prices or schedules waits for Larry.
// 'draft_only' — Laura writes, Larry sends. Nothing leaves on its own.
// 'full'       — Laura also sends scheduling links once a thread is clean.
async function autonomyLevel() {
  const fromEnv = env('LAURA_AUTONOMY').toLowerCase();
  const level = fromEnv || String(await getSetting('laura_autonomy', 'staged') || 'staged').replace(/"/g, '');
  return ['staged', 'draft_only', 'full'].includes(level) ? level : 'staged';
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

function firstNumber(value) {
  const match = String(value || '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function largestNumber(value) {
  const numbers = String(value || '').replace(/,/g, '').match(/\d+/g);
  if (!numbers) return null;
  return numbers.reduce((max, item) => Math.max(max, Number(item)), 0);
}

function shortQuote(value, fallback = 'not provided') {
  const text = trim(value, 140);
  return text ? `"${text}"` : fallback;
}

function geoTag(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return '';
  if (/\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|toronto|vancouver|montreal|ottawa|calgary|edmonton)\b/.test(text)) return 'Canada';
  if (/\b(united states|usa|u\.s\.a\.|u\.s\.|america|new york|nyc|brooklyn|manhattan|queens|bronx|staten island|vermont|california|texas|florida|georgia|illinois|ohio|pennsylvania|michigan|virginia|north carolina|south carolina|tennessee|washington|oregon|arizona|colorado|new jersey|massachusetts)\b/.test(text)) return 'United States';
  if (/\b(kenya|nairobi|kisii|mombasa|eldoret|nakuru)\b/.test(text)) return 'Kenya';
  if (/\b(uganda|kampala|jinja|gulu)\b/.test(text)) return 'Uganda';
  if (/\b(nigeria|lagos|abuja|ibadan|kano)\b/.test(text)) return 'Nigeria';
  if (/\b(zambia|lusaka|ndola|kitwe)\b/.test(text)) return 'Zambia';
  if (/\b(peru|lima|cusco)\b/.test(text)) return 'Peru';
  return '';
}

function looksForwardingPlan(value) {
  return /\b(forward|forwarded|courier|transport partner|friend|contact in|ship there first|carry|hand.?carry|relay|missionary returning|then send|then take)\b/i.test(String(value || ''));
}

function vagueShippingAddress(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/\b(down ?town|city hall|friend|can find|unknown|tbd|to be determined|later|not sure|none|n\/a)\b/i.test(text)) return true;
  return text.length < 35 && !/\d/.test(text) && !/\bp\.?o\.?\s*box\b/i.test(text);
}

function missingRequestFor(field) {
  const f = String(field || '').toLowerCase();
  if (f.includes('reference')) return 'An independent reference contact: full name, relationship to your work, and email or phone.';
  if (f.includes('website') || f.includes('sending')) return 'A ministry website/social link, or the name of the sending church or organization we can verify.';
  if (f.includes('power')) return 'The power and internet situation at the deployment location.';
  if (f.includes('language')) return 'The language or languages the community needs loaded on the kit.';
  if (f.includes('receiving plan details')) return 'Specific receiving-plan details: who receives it, where, and how it gets to the mission field.';
  if (f.includes('shipping')) return 'A real shipping or delivery destination, or a clear forwarding plan if it should ship somewhere outside the mission country first.';
  if (f.includes('receiving')) return 'How you expect to receive the equipment and handle customs/local delivery.';
  if (f.includes('contact')) return 'Your preferred contact method and time zone.';
  return field;
}

export function detectApplicantClarificationNeeds(app) {
  const concerns = [];
  const tier = Number(app && app.kit_tier) || null;
  const audience = String(app && app.audience_type || '');
  const currentReachMax = largestNumber(app && app.current_reach);
  const reachPlan = trim(app && app.reach_justification, 2000);
  const appEmail = normalizeEmail(app && app.email);
  const refEmail = normalizeEmail(app && app.reference_contact);
  const name = trim(app && app.name, 160);
  const missionCountry = trim(app && app.country, 160);
  const missionCountryTag = geoTag(missionCountry);
  const missionRegionTag = geoTag(app && app.region);
  const shippingText = [app && app.shipping_address, app && app.receiving_plan_details].filter(Boolean).join(' ');
  const shippingTag = geoTag(shippingText);
  const shippingPlanText = [app && app.receiving_plan, app && app.receiving_plan_details, app && app.shipping_address].filter(Boolean).join(' ');

  if (!name || /^full\s*name\*?$/i.test(name) || normalizeEmail(name)) {
    concerns.push({
      code: 'placeholder_name',
      summary: `The applicant name looks like a placeholder: ${shortQuote(name)}.`,
      request: 'Your real full name and role in the ministry or deployment.',
    });
  }

  if (tier >= 4 && (audience === 'individual' || audience === 'small_group')) {
    concerns.push({
      code: 'tier_audience_mismatch',
      summary: `The form requests ${kitLabel(app)}, but the audience is listed as ${shortQuote(audience.replace(/_/g, ' '))}.`,
      request: 'Confirm the correct kit tier. If you still need Tier 4 or Tier 5, explain the congregation or regional network it will serve, including gathering points and expected people reached.',
    });
  }

  if (tier === 5 && audience !== 'regional_network' && !(audience === 'individual' || audience === 'small_group')) {
    concerns.push({
      code: 'tier_5_not_regional',
      summary: `Tier 5 is for regional receive-and-replay deployments, but the audience is not listed as a regional network.`,
      request: 'Describe the actual regional deployment plan for Tier 5, or tell us which smaller tier fits this request.',
    });
  }

  if (tier === 5 && currentReachMax != null && currentReachMax < 100) {
    concerns.push({
      code: 'tier_5_low_reach',
      summary: `The current reach is ${shortQuote(app.current_reach)}, which is far below the normal Tier 5 regional scale.`,
      request: 'Explain how this grows to a multi-village or 100+ person deployment, or confirm that a smaller kit is the right request.',
    });
  } else if (tier >= 4 && currentReachMax != null && currentReachMax < 25) {
    concerns.push({
      code: 'large_tier_low_reach',
      summary: `The current reach is ${shortQuote(app.current_reach)} for a large equipment tier.`,
      request: 'Clarify the actual group size and why this larger equipment tier is needed now.',
    });
  }

  if (tier >= 4 && firstNumber(reachPlan) == null && reachPlan.length < 80) {
    concerns.push({
      code: 'large_tier_weak_reach_plan',
      summary: `The reach plan is too thin for a large kit request: ${shortQuote(reachPlan)}.`,
      request: 'Add a concrete reach plan: locations, leaders responsible, gathering rhythm, and rough number of people served.',
    });
  }

  if (appEmail && refEmail && appEmail === refEmail) {
    concerns.push({
      code: 'self_reference',
      summary: `The reference contact uses the same email as the applicant.`,
      request: 'Provide an independent reference who knows your ministry, with their email or phone.',
    });
  }

  if (/\b(jim\s+crow|test|asdf|fake|sample)\b/i.test(String(app && app.reference_name || ''))) {
    concerns.push({
      code: 'reference_needs_verification',
      summary: `The reference name needs clarification before review: ${shortQuote(app.reference_name)}.`,
      request: 'Send a verifiable reference: full name, relationship, and email or phone.',
    });
  }

  if (missionCountryTag && missionRegionTag && missionCountryTag !== missionRegionTag) {
    concerns.push({
      code: 'mission_location_mismatch',
      summary: `The mission country is ${shortQuote(app.country)}, but the region/city looks like ${missionRegionTag}: ${shortQuote(app.region)}.`,
      request: 'Confirm the actual mission country, city/region, and where the equipment will be used.',
    });
  }

  if (missionCountryTag && shippingTag && missionCountryTag !== shippingTag && !looksForwardingPlan(shippingPlanText)) {
    concerns.push({
      code: 'shipping_country_mismatch',
      summary: `The mission country is ${shortQuote(app.country)}, but the shipping or delivery destination looks like ${shippingTag}: ${shortQuote(app.shipping_address || app.receiving_plan_details)}.`,
      request: 'Confirm whether the kit should ship to the mission country or to a forwarding contact, and give the recipient name and full delivery plan.',
    });
  }

  if (vagueShippingAddress(app && app.shipping_address)) {
    concerns.push({
      code: 'vague_shipping',
      summary: `The shipping destination is not specific enough to act on: ${shortQuote(app.shipping_address)}.`,
      request: 'Provide a real recipient name plus address/city/country/phone, or say clearly that you need help finding a shipping path.',
    });
  }

  const seen = new Set();
  return concerns.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  }).slice(0, 9);
}

function hasInboundRole(messages, role) {
  return asArray(messages).some((m) => m.role === role && (m.direction === 'inbound' || m.status === 'received'));
}

function applicantClarificationDecision(app, thread, messages, concerns = detectApplicantClarificationNeeds(app), missing = detectMissingFields(app)) {
  const requests = [
    ...asArray(concerns).map((item) => item.request),
    ...asArray(missing).map(missingRequestFor),
  ].map((x) => trim(x, 260)).filter(Boolean);
  const uniqueRequests = [];
  const seen = new Set();
  requests.forEach((request) => {
    const key = request.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRequests.push(request);
    }
  });
  const tier = Number(app && app.kit_tier) || null;
  const highTierNote = tier >= 4
    ? [
      '',
      `For Tier ${tier} requests, we need a clear congregation or regional deployment plan before Larry reviews it. If this is mainly for an individual or small group, that is okay, but we need to move it into the smaller kit lane instead of treating it like a regional deployment.`,
    ]
    : [];
  return {
    next_action: 'ask_customer',
    state: 'waiting_on_customer',
    audience: 'applicant',
    missing_fields: uniqueRequests.slice(0, 8),
    summary: `${app.name || 'Applicant'} needs to clarify applicant-provided discrepancies before Larry review: ${asArray(concerns).map((c0) => c0.code).join(', ') || missing.join(', ')}.`,
    draft_subject: `Clarification needed for your VillageServer application [VS-${thread.thread_token}]`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      `Thank you for sending the VillageServer application. Before I can move this to Larry for review, I need to clean up a few details that do not line up in the form.`,
      '',
      concerns.length ? `What I am seeing:` : `What I still need:`,
      ...(concerns.length ? concerns.map((item) => `- ${item.summary}`) : missing.map((field) => `- ${missingRequestFor(field)}`)),
      '',
      `Please reply with:`,
      ...uniqueRequests.slice(0, 7).map((request, index) => `${index + 1}. ${request}`),
      ...highTierNote,
      '',
      `Once those details are clear, I can keep your file moving.`,
      '',
      `${config().agentName}`,
      `VillageServer Initiative`,
    ].join('\n'),
    reasoning: 'Applicant-resolvable intake discrepancies must be clarified with the applicant before asking Larry for a decision.',
    auto_send_ok: true,
  };
}

function latestMessage(messages, role) {
  return asArray(messages).filter((m) => m.role === role).slice(-1)[0] || null;
}

function sentActionCount(messages, actionType) {
  return asArray(messages).filter((m) => m.action_type === actionType && m.status === 'sent').length;
}

// A card needs exactly two things. Once both are on the file, there is nothing
// left to ask and the thread can close itself out.
function hasCardDetails(app) {
  return !!(trim(app && app.languages, 200) && trim(app && app.shipping_address, 400)
    && !vagueShippingAddress(app && app.shipping_address));
}

function hasOfferedSdCard(messages) {
  return asArray(messages).some((m) => m.action_type === 'offer_sd_card' && m.status === 'sent');
}

// "Comfortable with the person": nothing in the form contradicts itself and
// nothing important is missing. Language and shipping are deliberately not
// blocking — the offer itself is what asks for those two.
function readyForOffer(app, messages = []) {
  // Form contradictions block the offer only until the applicant has had a
  // chance to explain. Once they have written back, the explanation is in the
  // thread and re-flagging the same discrepancy forever would strand the file —
  // Achebe's Vermont address forwarded on to Kenya by his brother is a real
  // arrangement, not an error, and no regex is going to settle that.
  if (!hasInboundRole(messages, 'applicant') && detectApplicantClarificationNeeds(app).length) return false;
  return detectMissingFields(app).filter((field) => !/language|shipping|receiving/i.test(field)).length === 0;
}

// Written to be read aloud, not assembled: "a Raspberry Pi VillageServer",
// never "raspberry pi villageserver".
function kitNoun(app) {
  return {
    1: 'a microSD card',
    2: 'a Wi-Fi sharing hub',
    3: 'a Raspberry Pi VillageServer',
    4: 'a projector and audio kit',
    5: 'a satellite receive-and-replay kit',
  }[Number(app && app.kit_tier)] || 'the equipment you asked about';
}

// The close. They gave a language and a real address, so the file is done —
// tell them plainly, promise nothing about dates, and hand the details to the
// deployment log. No reason for anyone to press a button for this.
function cardConfirmationDecision(app, thread) {
  const c = config();
  return {
    next_action: 'confirm_card',
    state: 'ready_to_ship',
    audience: 'applicant',
    missing_fields: [],
    summary: `${app.name || 'Applicant'} confirmed ${trim(app.languages, 120)} and a shipping address. Card details filed for sending.`,
    draft_subject: `Your VillageServer card`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      `That is everything I needed — thank you.`,
      '',
      `I have your card down for ${trim(app.languages, 160)}, going to:`,
      trim(app.shipping_address, 400),
      '',
      `It is on our list to send. I cannot give you a firm date, and I would rather say that than guess at one — but if anything changes on your end, especially the address, just reply here and I will update it.`,
      '',
      `Thank you for your patience, and for the work you are doing.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].join('\n'),
    reasoning: 'Language and a usable shipping address are both on file, so the card details are complete.',
    auto_send_ok: true,
  };
}

// The honest scale-down. Warm about the ministry, straight about what we can
// actually post today, and it asks for exactly the two things a card needs.
function sdCardOfferDecision(app, thread) {
  const c = config();
  const askedForMore = Number(app && app.kit_tier) > 1;
  const askedForFunding = !!trim(app && app.funding_needed, 200);
  const place = trim(app && app.country, 120);
  const reach = trim(app && app.current_reach, 60);

  return {
    next_action: 'offer_sd_card',
    state: 'waiting_on_customer',
    audience: 'applicant',
    missing_fields: ['languages needed', 'shipping address'],
    summary: `${app.name || 'Applicant'} is verified and complete. Offered the microSD card and asked for language + shipping address.`,
    draft_subject: `About your VillageServer request`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      `Thank you for walking me through your work${place ? ` in ${place}` : ''}. What you are doing to bring God's Word to the people around you${reach ? `, reaching around ${reach} of them,` : ''} is exactly the kind of outreach we want to help go further.`,
      '',
      `I want to be straight with you about where we are right now, because I would rather tell you plainly than leave you waiting.`,
      '',
      (askedForMore || askedForFunding)
        ? `We are not able to send ${askedForMore ? kitNoun(app) : 'equipment'}${askedForFunding ? ' or funding' : ''} at this stage.`
        : `Our supply is limited at this stage.`,
      '',
      `What we are sending out today is microSD cards loaded with the offline library in the language your community actually reads and hears — Scripture, audio Bible, gospel films and teaching material. The card works on an ordinary phone with no internet at all, and it can be copied on to other phones once it reaches you.`,
      '',
      `If that would help the people you are reaching, just reply with two things:`,
      `1. The language or languages your community needs on the card.`,
      `2. A shipping address, including a recipient name and a phone number.`,
      '',
      `Once I have those, I will be in touch about getting a card out to you. And as more equipment becomes available, your file stays with us — this is not a no, it is a not yet for the larger kits.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].filter((line) => line !== null).join('\n'),
    reasoning: 'File is complete and verified; scaled the request down to what the initiative can actually post today.',
    auto_send_ok: true,
  };
}

function sentToApplicant(messages) {
  return asArray(messages)
    .filter((m) => m.direction === 'outbound' && m.status === 'sent' && m.role === 'agent')
    .filter((m) => !asArray(m.to_email).map(normalizeEmail).includes(normalizeEmail(config().larryEmail)));
}

// When Laura last wrote to this applicant, so she cannot chase them twice in a
// day no matter how many times the agent is triggered.
function lastApplicantSendAt(messages) {
  const times = sentToApplicant(messages)
    .map((m) => new Date(m.sent_at || m.created_at).getTime())
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}

function hoursSinceLastApplicantSend(messages) {
  const at = lastApplicantSendAt(messages);
  return at == null ? Infinity : (Date.now() - at) / 3600000;
}

function nudgeCount(messages) {
  return sentToApplicant(messages).filter((m) => m.action_type === 'follow_up_nudge').length;
}

// Is there an unanswered message from the applicant sitting there? Distinct
// from "not quiet": a brand new file has no outbound and no inbound, and that
// is nobody replying — it is nobody having spoken yet.
function applicantRepliedSinceLastSend(messages) {
  const inbound = asArray(messages)
    .filter((m) => m.role === 'applicant' && m.direction === 'inbound')
    .map((m) => new Date(m.created_at).getTime())
    .filter((t) => Number.isFinite(t));
  if (!inbound.length) return false;
  const lastOut = lastApplicantSendAt(messages);
  return lastOut == null || Math.max(...inbound) > lastOut;
}

// Has the applicant said anything since Laura's last message? If not, the ball
// is still in their court and a nudge is the right move.
function applicantWentQuiet(messages) {
  const lastOut = lastApplicantSendAt(messages);
  if (lastOut == null) return false;
  const lastIn = asArray(messages)
    .filter((m) => m.role === 'applicant' && m.direction === 'inbound')
    .map((m) => new Date(m.created_at).getTime())
    .filter((t) => Number.isFinite(t));
  return !lastIn.length || Math.max(...lastIn) < lastOut;
}

function fallbackDecision(app, thread, messages) {
  const missing = detectMissingFields(app);
  const clarificationNeeds = detectApplicantClarificationNeeds(app);
  const lastLarry = latestMessage(messages, 'larry');
  if (lastLarry) {
    // Larry gave an instruction and the model is unavailable to read it. Guessing
    // at what he wanted and mailing that guess to a missionary is the worst
    // failure mode here, so hold everything and flag it for a human instead.
    return {
      next_action: 'escalate',
      state: 'waiting_on_larry',
      audience: 'internal',
      missing_fields: missing,
      summary: `Larry replied on ${app.name || 'this applicant'} but Laura could not read the instruction.`,
      draft_subject: `Unread instruction from Larry [VS-${thread.thread_token}]`,
      draft_body: [
        `Larry replied on this thread, but Laura could not interpret the instruction.`,
        '',
        `What he wrote:`,
        trim(lastLarry.body, 1200) || '(empty message)',
        '',
        `Open the file and reply to the applicant by hand, or rerun Laura once the model is reachable.`,
      ].join('\n'),
      reasoning: 'Held because Anthropic is unavailable and Larry\'s instruction cannot be carried out blind.',
      auto_send_ok: false,
    };
  }
  if (clarificationNeeds.length && !hasInboundRole(messages, 'applicant')) {
    return applicantClarificationDecision(app, thread, messages, clarificationNeeds, missing);
  }

  const cardsOnly = offerMode() === 'sd_card_only';
  const offered = hasOfferedSdCard(messages);
  // Same rule as normalizeDecision: a card already confirmed or posted is not a
  // card still being arranged, so neither of the next two branches applies.
  const settled = POST_SHIPPING_STATES.has(String(thread && thread.state || ''))
    || sentActionCount(messages, 'confirm_card') > 0;

  // Everything a card needs is on file — close it out.
  if (cardsOnly && !settled && offered && hasCardDetails(app)) {
    return cardConfirmationDecision(app, thread);
  }

  // Verified and consistent, but they have not been levelled with yet.
  if (cardsOnly && !settled && !offered && readyForOffer(app, messages)) {
    return sdCardOfferDecision(app, thread);
  }

  // She has asked and asked and the gaps are still there. Stop looping.
  if (missing.length && sentActionCount(messages, 'ask_customer') >= config().maxAskRounds) {
    return {
      next_action: 'ask_larry',
      state: 'waiting_on_larry',
      audience: 'larry',
      missing_fields: missing,
      summary: `${app.name || 'Applicant'} has replied but still has not given: ${missing.join(', ')}. I have asked ${config().maxAskRounds} times.`,
      draft_subject: `Stuck on ${app.name || 'an applicant'}`,
      draft_body: [
        `Larry,`,
        '',
        `I have gone back to this applicant ${config().maxAskRounds} times and these are still outstanding:`,
        ...missing.map((field) => `- ${field}`),
        '',
        `They are replying, so they are not ignoring us — I just cannot get these details out of them. Your call on whether to keep going or let it rest.`,
        '',
        appSummaryLines(app).filter((line) => !line.endsWith(': ')).join('\n'),
        '',
        config().agentName,
      ].join('\n'),
      reasoning: `Hit the ${config().maxAskRounds}-round asking limit with gaps remaining.`,
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
  // Already confirmed or posted, and the model is not available to read what
  // they just wrote. There is nothing to decide and nothing to chase, so hold
  // it as a note rather than mailing Larry a review request for a finished file.
  if (settled) {
    return {
      next_action: 'escalate',
      state: trim(thread && thread.state, 80) || 'shipped',
      audience: 'internal',
      missing_fields: [],
      summary: `${app.name || 'Applicant'} wrote in on a card that is already settled, and Laura could not read it.`,
      draft_subject: `Unread reply on a settled file [VS-${thread.thread_token}]`,
      draft_body: [
        `This file is already past the card confirmation, and a message came in that Laura could not interpret.`,
        '',
        `Open the thread and read it by hand, or rerun Laura once the model is reachable.`,
      ].join('\n'),
      reasoning: 'Held as a note because the card is settled and Anthropic is unavailable.',
      auto_send_ok: false,
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

// Exported so the overrides can be tested directly: these are the rules that
// stop the model promising equipment that does not exist, and they are worth
// pinning down with real cases rather than only asserting they are present.
export function normalizeDecision(decision, app, thread, messages) {
  const fallback = fallbackDecision(app, thread, messages);
  const d = decision && typeof decision === 'object' ? decision : fallback;
  const nextAction = String(d.next_action || fallback.next_action);
  const safeActions = new Set([
    'ask_customer', 'ask_larry', 'reply_customer', 'send_schedule_link',
    'file_deployment', 'request_rollout_photos', 'close', 'escalate',
    'offer_sd_card', 'confirm_card', 'follow_up_nudge',
  ]);
  const action = safeActions.has(nextAction) ? nextAction : fallback.next_action;
  const audience = ['applicant', 'larry', 'internal'].includes(String(d.audience || '')) ? String(d.audience) : fallback.audience;
  const clarificationNeeds = detectApplicantClarificationNeeds(app);
  const mustAskApplicantFirst = clarificationNeeds.length && !hasInboundRole(messages, 'applicant') && !hasInboundRole(messages, 'larry');
  if (mustAskApplicantFirst && (audience === 'larry' || action === 'ask_larry' || action === 'escalate')) {
    const forced = applicantClarificationDecision(app, thread, messages, clarificationNeeds, detectMissingFields(app));
    return {
      ...forced,
      auto_send_ok: forced.auto_send_ok && d.auto_send_ok !== false,
      reasoning: `${forced.reasoning} Overrode ${action} because Laura should ask the applicant before Larry when the form details contradict themselves.`,
    };
  }

  // The model does not get to promise a kit, a call or funding while only cards
  // are going out. On a clean file the honest scale-down replaces whatever it
  // proposed, in exactly the same way clarifications override a premature
  // hand-off to Larry.
  // `ask_customer` and `reply_customer` are in here too: once a reply has been
  // transcribed onto the file, the model's plan to ask for something is often
  // out of date, and asking for what they already sent is exactly the failure
  // that makes an autonomous agent look broken.
  const supersedable = [
    'ask_larry', 'send_schedule_link', 'file_deployment', 'ask_customer', 'reply_customer',
  ].includes(action);
  // Both of these rules are about getting a card *offered and agreed*. Once it
  // has been confirmed — or actually posted — they have done their job, and
  // re-running them would answer "thank you, it arrived" with the confirmation
  // letter all over again. Past that point the model's reply stands.
  const settled = POST_SHIPPING_STATES.has(String(thread && thread.state || ''))
    || sentActionCount(messages, 'confirm_card') > 0;
  if (offerMode() === 'sd_card_only' && supersedable && !settled) {
    if (hasOfferedSdCard(messages) && hasCardDetails(app)) {
      const forced = cardConfirmationDecision(app, thread);
      return {
        ...forced,
        auto_send_ok: forced.auto_send_ok && d.auto_send_ok !== false,
        reasoning: `${forced.reasoning} Overrode ${action} because the card details are already complete.`,
      };
    }
    if (!hasOfferedSdCard(messages) && readyForOffer(app, messages)) {
      const forced = sdCardOfferDecision(app, thread);
      return {
        ...forced,
        auto_send_ok: forced.auto_send_ok && d.auto_send_ok !== false,
        reasoning: `${forced.reasoning} Overrode ${action} because only microSD cards are going out right now.`,
      };
    }
  }
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
  const clarificationNeeds = detectApplicantClarificationNeeds(app);
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
    `Do not ask Larry to judge applicant-created contradictions before the applicant has clarified them. Ask the applicant first when location, shipping, reference, audience, tier, current reach, or identity details do not line up.`,
    `Tier 4 and Tier 5 requests need a real congregation or regional deployment plan. If a Tier 4/5 request says individual, small group, tiny current reach, vague reach plan, placeholder identity, or mismatched country/shipping, next_action must be ask_customer unless an applicant reply already resolved it.`,
    `If the applicant is missing routine details, ask for only the important missing details in a warm short email.`,
    ...(offerMode() === 'sd_card_only' ? [
      `WHAT IS ACTUALLY AVAILABLE RIGHT NOW: microSD cards loaded with the offline library, in the applicant's language. Nothing else. No Raspberry Pi servers, no projectors, no satellite kits, no funding, regardless of what tier they asked for.`,
      `So your goal for every applicant is: get the form details complete and consistent, and once you are satisfied the person and their ministry are real, use next_action "offer_sd_card". That message thanks them warmly, tells them plainly that only cards are going out for now, and asks for exactly two things: the language they need and a shipping address with a recipient name and phone.`,
      `Do not propose a call, a booking link, a deployment or a review by Larry as the next step for a clean file — the card offer comes first.`,
      `Once they have replied with a language and a real shipping address, use next_action "confirm_card": thank them, repeat the language and address back so they can correct it, and say the card is on the list to send. Never give or imply a shipping date.`,
      `Never suggest that a larger kit or funding is coming, is likely, or is being considered. You may say their file stays with us for when more equipment is available.`,
    ] : [
      `If ready for a call and a booking URL is available, send the booking URL. Booking URL: ${c.calBookingUrl || 'not configured'}.`,
    ]),
    `Escalate to Larry only for complaints, money disputes, safety concerns, custom pricing, final approval/denial, or shipping/scheduling instructions after applicant details are clear.`,
    `Do not use markdown headings. Email copy should be plain, concise, and human.`,
    `EXTRACTION — do this on every run where the applicant has replied. Read their replies and put any concrete detail they gave you into the "extracted" object, using these keys: ${Object.keys(EXTRACTABLE_FIELDS).join(', ')}. If they wrote "we speak Bemba and English" then extracted.languages is "Bemba, English"; if they gave an address, that is extracted.shipping_address. Only include a key when they actually told you it — never guess, never restate what is already on the form, and omit the key entirely if you are unsure. This is how their answers reach the file; without it you will keep asking for things they already sent.`,
    `Return ONLY valid JSON with this shape: {"next_action":"ask_customer|offer_sd_card|confirm_card|ask_larry|reply_customer|send_schedule_link|file_deployment|request_rollout_photos|close|escalate","state":"waiting_on_customer|waiting_on_larry|ready_to_schedule|scheduled|ready_to_ship|shipped|follow_up_photos|filed|closed|escalated","audience":"applicant|larry|internal","missing_fields":["..."],"summary":"one internal sentence","draft_subject":"...","draft_body":"...","reasoning":"one internal sentence","auto_send_ok":false,"extracted":{},"filing":{"title":"","detail":"","item_type":"deployment|campaign|shipping|photo_request|follow_up|note"}}`,
  ].join('\n');
  const user = [
    `Thread token: VS-${thread.thread_token}`,
    `Application:`,
    appSummaryLines(app).join('\n'),
    '',
    `Detected missing fields: ${missing.length ? missing.join(', ') : 'none'}`,
    `Applicant clarification needed before Larry review: ${clarificationNeeds.length ? clarificationNeeds.map((item) => `${item.code}: ${item.summary} Ask: ${item.request}`).join(' | ') : 'none'}`,
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

async function supersedeDraftsForThread(threadId) {
  if (!threadId) return;
  const rows = await selectRows(`intake_messages?select=id,metadata&thread_id=eq.${encodeURIComponent(String(threadId))}&status=eq.draft&direction=eq.outbound&order=created_at.desc&limit=20`);
  await Promise.all(rows.map((row) => patchRows(`intake_messages?id=eq.${encodeURIComponent(row.id)}`, {
    status: 'superseded',
    metadata: {
      ...(row.metadata || {}),
      superseded_at: new Date().toISOString(),
    },
  }).catch(() => null)));
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
  if (decision.next_action === 'offer_sd_card') return `About your VillageServer request ${token}`;
  if (decision.next_action === 'follow_up_nudge') return `Checking in on your VillageServer application ${token}`;
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

// Whether anything actually leaves is decided by autoSendGate() alone — one
// place, one answer, so no caller can accidentally widen what Laura may send.
export async function runLauraAgent({ threadId = '', applicationId = '', reason = 'manual' } = {}) {
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
  // Transcribe anything the applicant answered into the file BEFORE deciding
  // what to do, so the decision is made against what we now know rather than
  // the blank form they first submitted.
  // applyExtracted mutates `app` in place, so normalizeDecision below re-runs
  // readyForOffer / hasCardDetails against what we now know. No second model
  // call needed — the deterministic rules do the re-deciding.
  let extraction = { applied: {}, changes: {} };
  if (rawDecision && rawDecision.extracted) {
    extraction = await applyExtracted(app, rawDecision.extracted).catch(() => ({ applied: {}, changes: {} }));
  }

  const decision = normalizeDecision(rawDecision, app, thread, messages);
  const to = audienceToEmail(decision.audience, app);
  const outbound = decision.audience === 'applicant' || decision.audience === 'larry';
  const subject = subjectWithToken(decision.draft_subject || defaultSubjectFor(decision, app, thread), thread);
  if (outbound) await supersedeDraftsForThread(thread.id);
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
      extracted: extraction.changes,
    },
  });

  // Anything Laura learned from a reply gets its own visible entry, so a field
  // never changes on an application without a record of where it came from.
  if (Object.keys(extraction.changes).length) {
    await insertRow('agent_filing_items', {
      thread_id: thread.id,
      application_id: String(app.id),
      item_type: 'note',
      state: 'done',
      title: `Updated from their reply: ${Object.keys(extraction.changes).join(', ')}`,
      detail: Object.entries(extraction.changes)
        .map(([field, diff]) => `${field}: ${diff.from || '(blank)'} -> ${diff.to}`)
        .join('\n'),
      completed_at: new Date().toISOString(),
      metadata: { source_message_id: message && message.id },
    }).catch(() => null);
  }
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
  const gate = await autoSendGate({ decision, messages, outbound, audience: decision.audience });
  let sent = null;
  if (message && gate.allowed) {
    // A provider outage must not throw away the rest of the run. Treat it as a
    // hold with a real reason on it, so the draft survives, the thread stops
    // claiming it is waiting on the applicant, and the retry is scheduled
    // rather than left to whoever notices.
    try {
      sent = await sendMessageById(message.id);
    } catch (e) {
      gate.allowed = false;
      gate.kind = 'timing';
      gate.retry_hours = 1;
      gate.reason = `could not send: ${String((e && e.message) || e).slice(0, 160)}`;
    }
  }

  // Confirming a card ends Laura's part, not the job — the card still has to be
  // physically posted, and only Larry can do that. So she stops chasing the
  // applicant and puts the file in front of him with shipping buttons instead
  // of filing a deployment for something nobody has sent yet.
  let handedOver = null;
  if (sent && decision.next_action === 'confirm_card') {
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: 'ready_to_ship',
      owner: 'larry',
      next_follow_up_at: null,
      digest_pending: true,
      summary: `${app.name || 'Applicant'} confirmed ${trim(app.languages, 80)} and an address. Ready for you to post a card.`,
    }).catch(() => null);
    handedOver = await notifyLarryReadyToShip(thread, app).catch(() => null);
  } else if (sent && decision.audience === 'applicant') {
    // Otherwise the ball is with them, so schedule the next nudge.
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      next_follow_up_at: daysFromNow(config().followUpDays),
    }).catch(() => null);
  } else if (!outbound) {
    // An internal note means a person has to look at this — there is nothing
    // left to schedule. Clearing the clock matters: a past-due one that no
    // branch ever resolves would re-run the model on this file every tick.
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      next_follow_up_at: null,
      owner: 'larry',
    }).catch(() => null);
  } else if (!sent) {
    // Nothing went out, so the thread must not claim it is waiting on anyone.
    // A policy hold needs a person to release the draft; a timing hold just
    // needs the clock to run down. Saying "waiting on the applicant" for either
    // is how a file goes quiet with a letter still sitting in the drawer.
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, gate.kind === 'timing'
      ? { next_follow_up_at: new Date(Date.now() + (gate.retry_hours || 1) * 3600000).toISOString() }
      : {
        owner: 'larry',
        state: 'waiting_on_larry',
        summary: `${decision.summary || ''} Held: ${gate.reason}.`.trim(),
      }).catch(() => null);
  }

  // They wrote back about a card that already reached them. Their words belong
  // in the write-up Laura filed for them, so capture it before the thread goes
  // quiet.
  let fieldUpdate = null;
  if (POST_SHIPPING_STATES.has(String(thread.state || '')) && applicantRepliedSinceLastSend(messages)) {
    fieldUpdate = await appendReplyToWriteUp(thread, app, messages).catch(() => null);
  }

  return {
    ok: true,
    thread_id: thread.id,
    application_id: app.id,
    decision,
    message,
    sent,
    field_update: fieldUpdate ? fieldUpdate.id : null,
    held: sent ? null : gate.reason,
    learned: extraction.changes,
    handed_to_larry: !!handedOver,
  };
}

// The second hand-off, after the card is actually in the post. Larry gets his
// own card — same formatting as every other file he sees — carrying the two
// things only he can supply: the tracking number and the donation link. The
// number is typed on the page the button opens, because mail clients strip
// forms out of a message body.
async function notifyLarryPosted(thread, app, post) {
  const c = config();
  const message = await createMessage({
    thread_id: thread.id,
    role: 'agent',
    channel: 'email',
    direction: 'outbound',
    action_type: 'posted_followup',
    subject: subjectWithToken(`Posted: ${app.name || 'an applicant'} — tracking number?`, thread),
    body: [
      `The card for ${app.name || 'this applicant'} is filed as posted and they have been told it is on its way.`,
      '',
      `Two things left, both one tap:`,
      '',
      `1. The tracking number, if the post gave you one. Tap the button and type it in — I will pass it straight on to them.`,
      post && post.published
        ? `2. I have written this deployment up as "${post.title}" and it is live on the site.`
        : post
          ? `2. I have written this deployment up as "${post.title}". Have a read, and tap publish when you are happy for it to go on the site — it names them and where they are, so I would rather you saw it first.`
          : `2. I could not file a write-up for this one — worth checking the admin panel.`,
      '',
      `If there is no tracking number, say so and I will stop asking.`,
    ].join('\n'),
    from_email: c.agentEmail,
    to_email: [normalizeEmail(c.larryEmail)],
    status: 'draft',
    metadata: { reason: 'posted_followup', post_id: post && post.id },
  });
  return message ? sendMessageById(message.id).catch(() => null) : null;
}

// The hand-off at the shipping stage. Larry gets one email that says exactly
// what to post and where, with buttons that let him answer "posted it" without
// opening the admin panel.
async function notifyLarryReadyToShip(thread, app) {
  const c = config();
  const fresh = await loadThreadBy({ threadId: thread.id }) || thread;
  const message = await createMessage({
    thread_id: thread.id,
    role: 'agent',
    channel: 'email',
    direction: 'outbound',
    action_type: 'ready_to_ship',
    subject: subjectWithToken(`Ready to post: ${app.name || 'an applicant'}`, thread),
    // The address is not repeated here on purpose — it has its own block on the
    // card below, set in monospace with their line breaks kept, so there is one
    // place to read it from and no chance of the two disagreeing.
    body: [
      `${app.name || 'An applicant'} has confirmed everything for a card, and the address to post it to is below.`,
      '',
      `Nothing is filed yet — when you have actually posted it, use the button below and I will file the deployment, tell them it is on the way, and come back to you for the tracking number.`,
    ].join('\n'),
    from_email: c.agentEmail,
    to_email: [normalizeEmail(c.larryEmail)],
    status: 'draft',
    metadata: { reason: 'ready_to_ship' },
  });
  return message ? sendMessageById(message.id).catch(() => null) : null;
}

// The single place that decides whether an email leaves without Larry. Every
// condition must pass: the autonomy level allows this action, the model agreed,
// the applicant has not been written to inside the cooldown, and Laura has not
// already chased them more times than the cap allows.
//
// A hold also says what *kind* of hold it is, because the two mean opposite
// things for the file. A `policy` hold needs a person to release it, so the
// thread belongs to Larry. A `timing` hold just means not yet, so the thread
// stays where it is and comes back on its own.
async function autoSendGate({ decision, messages, outbound, audience }) {
  if (!outbound) return { allowed: false, kind: 'policy', reason: 'internal note' };
  const c = config();
  const level = await autonomyLevel();
  if (level === 'draft_only') return { allowed: false, kind: 'policy', reason: 'autonomy is draft-only' };

  // Mail to Larry is a notification, not a decision. It carries no promise to
  // the applicant, so it is neither rate limited nor held for approval — that
  // is the whole point of getting a file in front of him.
  if (audience === 'larry') return { allowed: true, kind: '', reason: '' };

  const action = decision.next_action;
  const answering = applicantRepliedSinceLastSend(messages);
  const selfSendable = SELF_SEND_ACTIONS.has(action)
    || (level === 'full' && action === 'send_schedule_link');
  if (!selfSendable) return { allowed: false, kind: 'policy', reason: `${action} always waits for Larry` };
  if (!decision.auto_send_ok) return { allowed: false, kind: 'policy', reason: 'Laura flagged this one for review' };

  // reply_customer covers two things: carrying out an instruction from Larry,
  // and simply answering someone who wrote in. Either is a reason to speak. A
  // "reply" with neither behind it is Laura talking to herself, so that is the
  // only case worth blocking.
  if (action === 'reply_customer' && !hasInboundRole(messages, 'larry') && !answering) {
    return { allowed: false, kind: 'policy', reason: 'nothing to reply to' };
  }

  // The cooldown governs *unprompted* contact. Once someone has written back,
  // answering them is the job — refusing to reply for a day because she happened
  // to write that morning is how a receptionist looks broken, not careful. The
  // round cap is what bounds a genuine back-and-forth.
  const hours = hoursSinceLastApplicantSend(messages);
  if (!answering && hours < c.cooldownHours) {
    return {
      allowed: false,
      kind: 'timing',
      retry_hours: Math.max(1, Math.ceil(c.cooldownHours - hours)),
      reason: `cooldown — wrote to them ${Math.round(hours)}h ago, no reply yet`,
    };
  }
  if (action === 'follow_up_nudge' && nudgeCount(messages) >= c.maxNudges) {
    return { allowed: false, kind: 'policy', reason: `already nudged ${c.maxNudges} times` };
  }
  return { allowed: true, kind: '', reason: '' };
}

// Work through every file that is genuinely waiting on Laura. Runs one at a
// time on purpose — this sends real mail to real people, and a burst of
// parallel calls is both harder to stop and harder to read afterwards.
//
// `dryRun` answers "who would this write to?" without calling the model or
// sending anything, so the count can be confirmed before it happens.
export async function runAllWaitingThreads({ limit = 40, dryRun = false } = {}) {
  if (!(await settingBool('laura_agent_enabled', true))) {
    return { ok: false, skipped: true, reason: 'Laura agent is disabled.' };
  }
  const c = config();
  const threads = await selectRows(
    `intake_threads?select=*&state=in.(new,waiting_on_customer)`
    + `&order=created_at.asc&limit=${Number(limit) || 40}`,
  );

  const eligible = [];
  const held = [];
  for (const thread of threads) {
    const label = {
      thread_id: thread.id,
      name: thread.applicant_name || 'Applicant',
      email: thread.applicant_email || '',
      token: thread.thread_token,
    };
    // Files parked with Larry are his call, not hers.
    if (String(thread.owner || '') === 'larry') {
      held.push({ ...label, reason: 'waiting on Larry' });
      continue;
    }
    const messages = await messagesForThread(thread.id);
    const answering = applicantRepliedSinceLastSend(messages);
    const hours = hoursSinceLastApplicantSend(messages);
    if (!answering && hours < c.cooldownHours) {
      held.push({ ...label, reason: `emailed ${Math.round(hours)}h ago, no reply yet` });
      continue;
    }
    eligible.push({
      ...label,
      last_contact: answering ? 'replied — waiting on us'
        : hours === Infinity ? 'never contacted' : `${Math.round(hours / 24)}d ago`,
    });
  }

  if (dryRun) return { ok: true, dry_run: true, would_contact: eligible, held };

  const results = [];
  for (const item of eligible) {
    try {
      const run = await runLauraAgent({ threadId: item.thread_id, reason: 'run_all' });
      results.push({
        ...item,
        action: run.decision && run.decision.next_action,
        sent: !!run.sent,
        held: run.held || null,
      });
    } catch (e) {
      results.push({ ...item, error: String((e && e.message) || e) });
    }
  }
  return {
    ok: true,
    considered: threads.length,
    sent: results.filter((r) => r.sent).length,
    results,
    held,
  };
}

// Every file Laura owns should either have a next step on the clock or be
// sitting with a human. One with neither has been dropped — the run that
// created it died before it could decide anything, or a send failed in a way
// nothing re-armed. Nothing else in the system looks for these, so without this
// they wait for somebody to notice them in the panel.
//
// Deliberately narrow: a healthy thread always has a follow-up scheduled, so a
// working queue sweeps to nothing and this never re-runs files that are fine.
export async function sweepStalledThreads({ limit = 15, dryRun = false } = {}) {
  if (!(await settingBool('laura_agent_enabled', true))) {
    return { ok: false, skipped: true, reason: 'Laura agent is disabled.' };
  }
  const c = config();
  const candidates = await selectRows(
    `intake_threads?select=*&state=in.(new,waiting_on_customer)&next_follow_up_at=is.null`
    + `&owner=neq.larry&order=created_at.asc&limit=${Math.max(1, Number(limit) || 15) * 3}`,
  ).catch(() => []);

  // A run that just happened is not a stall — give the normal path time to
  // finish arming the file before treating it as abandoned.
  const cutoff = Date.now() - c.followUpDays * 86400000;
  const stalled = candidates.filter((thread) => {
    const at = new Date(thread.last_agent_run_at || 0).getTime();
    return !thread.last_agent_run_at || (Number.isFinite(at) && at < cutoff);
  }).slice(0, Number(limit) || 15);

  const label = (thread) => ({
    thread_id: thread.id,
    name: thread.applicant_name || 'Applicant',
    token: thread.thread_token,
    stalled_since: thread.last_agent_run_at || thread.created_at,
    reason: thread.last_agent_run_at ? 'no next step scheduled' : 'never ran',
  });

  if (dryRun) return { ok: true, dry_run: true, stalled: stalled.map(label) };

  const results = [];
  for (const thread of stalled) {
    try {
      const run = await runLauraAgent({ threadId: thread.id, reason: 'sweep' });
      results.push({
        ...label(thread),
        action: run.decision && run.decision.next_action,
        sent: !!run.sent,
        held: run.held || null,
      });
    } catch (e) {
      results.push({ ...label(thread), error: String((e && e.message) || e) });
    }
  }
  return { ok: true, considered: candidates.length, picked_up: results.length, results };
}

export async function listLauraThreads({ includeMessages = false, limit = 80 } = {}) {
  const threads = await selectRows(`intake_threads?select=*&order=updated_at.desc&limit=${Number(limit) || 80}`);
  if (!includeMessages || !threads.length) return { threads, messages: [], filing_items: [] };
  const threadIds = threads.map((t) => t.id);
  const applicationIds = new Set(threads.map((t) => String(t.application_id || '')).filter(Boolean));
  const messages = await selectRows(`intake_messages?select=*&order=created_at.asc&limit=500`);
  const filingItems = await selectRows(`agent_filing_items?select=*&order=created_at.desc&limit=300`);
  const applications = await selectRows('equipment_applications?select=*&order=created_at.desc&limit=300').catch(() => []);
  const deployments = await selectRows('deployments?select=*&order=created_at.desc&limit=300').catch(() => []);
  const allowed = new Set(threadIds);
  return {
    threads,
    messages: messages.filter((m) => !m.thread_id || allowed.has(m.thread_id)),
    filing_items: filingItems.filter((m) => !m.thread_id || allowed.has(m.thread_id)),
    applications: applications.filter((app) => applicationIds.has(String(app.id))),
    deployments: deployments.filter((row) => applicationIds.has(String(row.application_id || ''))),
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

async function sendResendEmail({ to, subject, text, html, replyTo }) {
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
      ...(html ? { html } : {}),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Resend ${response.status}`);
  return { provider: 'resend', provider_message_id: body.id || null };
}

function base64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanHeaderValue(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function encodeMailHeader(value) {
  const cleaned = cleanHeaderValue(value);
  if (!/[^\x20-\x7E]/.test(cleaned)) return cleaned;
  const chunks = [];
  let current = '';
  for (const char of cleaned) {
    const next = current + char;
    if (current && Buffer.byteLength(next, 'utf8') > 42) {
      chunks.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((part) => `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`).join(' ');
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

async function sendGmailEmail({ to, subject, text, html, replyTo }) {
  const c = config();
  const token = await gmailAccessToken();
  const recipient = Array.isArray(to) ? to.join(', ') : to;
  const headers = [
    `From: ${encodeMailHeader(c.agentName)} <${cleanHeaderValue(c.agentEmail)}>`,
    `To: ${cleanHeaderValue(recipient)}`,
    `Reply-To: ${cleanHeaderValue(replyTo || c.agentEmail)}`,
    `Subject: ${encodeMailHeader(subject)}`,
    'MIME-Version: 1.0',
  ];
  // multipart/alternative so clients that refuse HTML still get the letter.
  const boundary = `vs_${crypto.randomBytes(12).toString('hex')}`;
  const raw = html
    ? [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      '',
      `--${boundary}--`,
    ].join('\r\n')
    : [...headers, 'Content-Type: text/plain; charset=UTF-8', '', text].join('\r\n');
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(c.gmailUser)}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ raw: base64Url(raw) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Gmail send ${response.status}`);
  return { provider: 'gmail', provider_message_id: body.id || null, gmail_thread_id: body.threadId || null };
}

async function sendEmail({ to, subject, text, html, replyTo }) {
  const c = config();
  if (c.emailProvider === 'gmail') return sendGmailEmail({ to, subject, text, html, replyTo });
  return sendResendEmail({ to, subject, text, html, replyTo });
}

// Internal state names are for the panel, not for Larry's inbox.
const STAGE_LABELS = {
  new: 'Just arrived',
  waiting_on_larry: 'Waiting on you',
  waiting_on_customer: 'Waiting on the applicant',
  ready_to_schedule: 'Ready to book a call',
  scheduled: 'Call booked',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  follow_up_photos: 'Waiting on rollout photos',
  filed: 'Filed as a deployment',
  closed: 'Closed',
  escalated: 'Needs a closer look',
};

// The facts Larry needs to decide, shaped for the email templates.
// Everything Larry needs to address an envelope, in one block. Only built for
// the stages where posting is the actual next move — on an intake file it would
// be noise, and half the time the address is not even filled in yet.
const ADDRESSABLE_STAGES = new Set(['ready_to_ship', 'shipped', 'follow_up_photos', 'filed']);

function shipToFor(app, stage, thread) {
  const address = trim(app && app.shipping_address, 600);
  if (!address || !ADDRESSABLE_STAGES.has(String(stage || ''))) return null;
  const phone = [app.phone_country_code, app.phone].filter(Boolean).join(' ');
  // Their address usually already carries a phone number, because that is what
  // Laura asked for. Only add the one from the form when it is genuinely absent.
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const phoneAlreadyThere = phone && digits(address).includes(digits(phone).slice(-7));
  return {
    label: 'Post to',
    address,
    rows: [
      ['Card language', trim(app.languages, 200) || 'not given'],
      ['Applicant', trim(app.name, 160)],
      ['Phone', phoneAlreadyThere ? '' : phone],
      ['Tracking', trim(thread && thread.tracking_number, 120)],
    ],
  };
}

function threadCardItem(thread, app, { draft = null, headline = '', actions = null, extraFacts = [] } = {}) {
  const phone = app ? [app.phone_country_code, app.phone].filter(Boolean).join(' ') : '';
  const stage = thread && thread.state;
  return {
    shipTo: shipToFor(app, stage, thread),
    applicantName: (thread && thread.applicant_name) || (app && app.name) || 'Applicant',
    applicantEmail: (thread && thread.applicant_email) || (app && app.email) || '',
    threadToken: thread && thread.thread_token,
    headline: headline || (thread && thread.summary) || '',
    facts: [
      ['Requested', app ? kitLabel(app) : ''],
      ['Where', app ? [app.region, app.country].filter(Boolean).join(', ') : ''],
      ['Organization', app && app.organization],
      ['Role', app && app.role],
      ['Reach', app && app.current_reach],
      ['Languages', app && app.languages],
      ['Funding asked', app && app.funding_needed],
      ['Phone', phone],
      ['Stage', STAGE_LABELS[stage] || stage],
      ...asArray(extraFacts),
    ],
    flags: asArray(thread && thread.missing_fields).map((x) => String(x)).slice(0, 6),
    draft: draft ? { subject: draft.subject, body: draft.body } : null,
    buttons: actionButtonsFor(thread && thread.id, { hasDraft: !!draft, stage, actions }),
    adminUrl: adminFileUrl(thread && thread.id),
  };
}

// Larry's mail is a decision card; the applicant's is a plain letter.
async function renderOutbound(message, recipients) {
  const c = config();
  const toLarry = recipients.some((address) => address === normalizeEmail(c.larryEmail));
  if (!toLarry) {
    const thread = message.thread_id ? await loadThreadBy({ threadId: message.thread_id }) : null;
    return renderApplicantEmail({
      agentName: c.agentName,
      text: message.body,
      threadToken: thread && thread.thread_token,
    });
  }
  const thread = message.thread_id ? await loadThreadBy({ threadId: message.thread_id }) : null;
  if (!thread) return { html: '', text: message.body };
  const app = await loadApplication(thread.application_id).catch(() => null);
  const draft = await latestDraftForThread(thread.id).catch(() => null);
  const applicantDraft = draft && draft.id !== message.id
    && asArray(draft.to_email).map(normalizeEmail).includes(normalizeEmail(app && app.email))
    ? draft : null;

  // After the card is posted the question is no longer "do you approve this",
  // so the card carries the two things still outstanding instead of the intake
  // buttons — and shows what has already been answered.
  const posted = message.action_type === 'posted_followup';
  const writeUp = posted && app ? await postForApplication(app.id).catch(() => null) : null;
  return renderLarryActionEmail({
    agentName: c.agentName,
    intro: trim(message.body, 900),
    item: threadCardItem(thread, app, {
      draft: applicantDraft,
      actions: posted ? postedButtonNames() : null,
      extraFacts: posted ? [
        ['Tracking', thread.tracking_number || 'not added yet'],
        ['Write-up', writeUp ? `${writeUp.title} (${writeUp.published ? 'live' : 'waiting on you'})` : ''],
      ] : [],
    }),
  });
}

export async function sendMessageById(messageId) {
  const rows = await selectRows(`intake_messages?select=*&id=eq.${encodeURIComponent(String(messageId))}&limit=1`);
  const message = rows[0];
  if (!message) throw new Error('Draft not found.');
  if (message.status === 'sent') return { already_sent: true, message };
  if (message.direction !== 'outbound') throw new Error('Only outbound drafts can be sent.');
  const to = asArray(message.to_email).map(normalizeEmail).filter(Boolean);
  if (!to.length) throw new Error('Draft has no recipient.');
  const rendered = await renderOutbound(message, to).catch(() => ({ html: '', text: message.body }));
  const sent = await sendEmail({
    to,
    subject: message.subject,
    text: rendered.text || message.body,
    html: rendered.html || '',
    replyTo: config().agentEmail,
  });
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
  const appIds = new Set(threads.map((t) => String(t.application_id || '')).filter(Boolean));
  const applications = await selectRows('equipment_applications?select=*&order=created_at.desc&limit=300').catch(() => []);
  const appById = new Map(applications.filter((a) => appIds.has(String(a.id))).map((a) => [String(a.id), a]));

  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const items = threads.map((t) => {
    const threadMessages = (byThread.get(t.id) || []);
    const draft = threadMessages.find((m) => m.status === 'draft' && m.direction === 'outbound'
      && !asArray(m.to_email).map(normalizeEmail).includes(normalizeEmail(c.larryEmail)));
    const tasks = taskByThread.get(t.id) || [];
    const item = threadCardItem(t, appById.get(String(t.application_id)) || null, { draft: draft || null });
    if (tasks.length) item.facts.push(['Filing', tasks.map((task) => task.title).join('; ')]);
    return item;
  });

  const rendered = renderDigestEmail({
    agentName: c.agentName,
    stamp,
    items,
    adminUrl: `${siteBaseUrl()}/admin.html`,
  });
  const body = rendered.text;
  const subject = `${threads.length} VillageServer ${threads.length === 1 ? 'file needs' : 'files need'} you`;
  const sent = await sendEmail({
    to: c.larryEmail,
    subject,
    text: body,
    html: rendered.html,
    replyTo: c.agentEmail,
  });
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

// ── Larry's one-click actions ───────────────────────────────────────────
//
// Each button in Larry's email lands here. Every action is idempotent: the
// second click on the same link reports what already happened instead of doing
// it twice, which matters because mail clients and link scanners retry.

const DOUBLE_CLICK_WINDOW_MS = 5 * 60 * 1000;

async function recentLarryAction(threadId, action) {
  const rows = await selectRows(
    `intake_messages?select=id,created_at&thread_id=eq.${encodeURIComponent(threadId)}`
    + `&action_type=eq.larry_${encodeURIComponent(action)}&order=created_at.desc&limit=1`,
  ).catch(() => []);
  if (!rows.length) return null;
  const at = new Date(rows[0].created_at).getTime();
  return Number.isFinite(at) && Date.now() - at < DOUBLE_CLICK_WINDOW_MS ? rows[0] : null;
}

async function recordLarryAction(thread, action, note) {
  return createMessage({
    thread_id: thread.id,
    role: 'larry',
    channel: 'web',
    direction: 'inbound',
    action_type: `larry_${action}`,
    subject: `Larry chose: ${action}`,
    body: note,
    from_email: config().larryEmail,
    to_email: [config().agentEmail],
    status: 'received',
    metadata: { source: 'action_link', action },
  }).catch(() => null);
}

async function setApplicationStatus(applicationId, status) {
  return patchRows(`equipment_applications?id=eq.${encodeURIComponent(String(applicationId))}`, {
    status,
    status_updated_at: new Date().toISOString(),
  }).catch(() => null);
}

function approvalEmailBody(app) {
  const c = config();
  const booking = c.calBookingUrl;
  const needsAddress = !trim(app && app.shipping_address, 200);
  const needsLanguage = !trim(app && app.languages, 200);

  // Approving today means a card is going out — never a larger kit or funding,
  // whatever tier the form asked for.
  if (offerMode() === 'sd_card_only') {
    return [
      `Hi ${app.name || 'there'},`,
      '',
      `Good news — Larry has reviewed your application and we would like to get a microSD card out to you, loaded with the offline library in your language.`,
      '',
      ...(needsLanguage || needsAddress ? [
        `To get it moving I still need:`,
        ...(needsLanguage ? [`- The language or languages your community needs on the card.`] : []),
        ...(needsAddress ? [`- A shipping address, with a recipient name and a phone number.`] : []),
        '',
      ] : [
        `We have your language and shipping details on file, and I will be in touch as soon as the card is on its way.`,
        '',
      ]),
      `Thank you for your patience, and for the work you are doing.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].join('\n');
  }

  return [
    `Hi ${app.name || 'there'},`,
    '',
    `Good news — Larry has reviewed your VillageServer application and would like to move ahead with a conversation about your request for ${kitLabel(app).toLowerCase()}.`,
    '',
    booking
      ? `Please pick a time that works for you here: ${booking}`
      : `Larry will reach out shortly to set up a time to talk.`,
    '',
    `Before we talk, it helps to have a rough idea of your timing and how the equipment would reach you. If anything has changed since you applied, just reply and let me know.`,
    '',
    `We are glad you reached out.`,
    '',
    c.agentName,
    'VillageServer Initiative',
  ].join('\n');
}

function declineEmailBody(app) {
  const c = config();
  return [
    `Hi ${app.name || 'there'},`,
    '',
    `Thank you for taking the time to apply to the VillageServer Initiative, and for the work you are doing.`,
    '',
    `After review, we are not able to place a kit with you at this time. This is not a judgment of your ministry — our supply is limited and we have to weigh each request against how many people a kit can reach right now.`,
    '',
    `You are welcome to apply again as your work grows, and the printable field guides on our site are free to use in the meantime.`,
    '',
    `Thank you again, and God bless the work you are doing.`,
    '',
    c.agentName,
    'VillageServer Initiative',
  ].join('\n');
}

// `value` is whatever Larry typed on the action page — today that is the
// tracking number. Actions without inputs ignore it entirely.
export async function performLarryAction(threadId, action, { value = '' } = {}) {
  if (!isKnownAction(action)) throw new Error('Unknown action.');
  const thread = await loadThreadBy({ threadId });
  if (!thread) return { ok: false, tone: 'stop', title: 'File not found', message: 'That intake file no longer exists.' };
  const app = await loadApplication(thread.application_id);
  if (!app) return { ok: false, tone: 'stop', title: 'Application not found', message: 'The application behind this file has been removed.' };

  const who = thread.applicant_name || app.name || 'this applicant';
  const repeat = await recentLarryAction(thread.id, action);
  if (repeat) {
    return { ok: true, repeat: true, tone: 'neutral', title: 'Already done', message: `That was already applied to ${who} a moment ago. Nothing changed.` };
  }

  if (action === 'approve') {
    if (String(app.status || '') === 'approved') {
      return { ok: true, repeat: true, tone: 'go', title: 'Already approved', message: `${who} is already approved.` };
    }
    await recordLarryAction(thread, action, 'Larry approved this application from the intake email.');
    await setApplicationStatus(app.id, 'approved');
    await supersedeDraftsForThread(thread.id);
    const subject = subjectWithToken(`Your VillageServer application`, thread);
    const message = await createMessage({
      thread_id: thread.id,
      role: 'agent',
      channel: 'email',
      direction: 'outbound',
      action_type: 'send_schedule_link',
      subject,
      body: approvalEmailBody(app),
      from_email: config().agentEmail,
      to_email: [normalizeEmail(app.email)],
      status: 'draft',
      metadata: { reason: 'larry_action', action },
    });
    let sent = null;
    try {
      sent = message ? await sendMessageById(message.id) : null;
    } catch (e) {
      sent = null;
    }
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: sent ? 'ready_to_schedule' : 'waiting_on_larry',
      owner: 'laura',
      summary: `Larry approved. ${sent ? 'Scheduling note sent to the applicant.' : 'Scheduling note drafted but could not send.'}`,
      digest_pending: true,
      next_follow_up_at: new Date(Date.now() + config().followUpDays * 86400000).toISOString(),
    }).catch(() => null);
    const emailedWhat = offerMode() === 'sd_card_only'
      ? ' to say a card in their language is coming'
      : (config().calBookingUrl ? ' the booking link' : '');
    return sent
      ? { ok: true, tone: 'go', title: 'Approved', message: `${who} is approved and I have emailed them${emailedWhat}.`, detail: 'You will see their reply in the usual place.' }
      : { ok: true, tone: 'neutral', title: 'Approved — email held', message: `${who} is marked approved, but the email could not go out.`, detail: 'The note is saved as a draft in the admin panel; send it from there.' };
  }

  if (action === 'send-draft') {
    const draft = await latestDraftForThread(thread.id);
    if (!draft) return { ok: true, tone: 'neutral', title: 'Nothing to send', message: `There is no draft waiting on ${who} right now.` };
    await recordLarryAction(thread, action, 'Larry approved sending the pending draft.');
    const sent = await sendMessageById(draft.id);
    return sent && sent.already_sent
      ? { ok: true, repeat: true, tone: 'neutral', title: 'Already sent', message: 'That draft had already gone out.' }
      : { ok: true, tone: 'go', title: 'Sent', message: `The draft is on its way to ${who}.` };
  }

  if (action === 'more-info') {
    await recordLarryAction(thread, action, 'Larry asked Laura to go back to the applicant for more information.');
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: 'waiting_on_customer', owner: 'laura', digest_pending: true,
    }).catch(() => null);
    const run = await runLauraAgent({ threadId: thread.id, reason: 'larry_action' }).catch(() => null);
    const wentOut = run && run.sent;
    return {
      ok: true,
      tone: 'go',
      title: wentOut ? 'Asked them' : 'Drafted',
      message: wentOut
        ? `I have written to ${who} asking for what is still missing.`
        : `I have drafted the follow-up to ${who}.`,
      detail: wentOut ? '' : `Held back: ${(run && run.held) || 'waiting for approval in the admin panel'}.`,
    };
  }

  if (action === 'hold') {
    await recordLarryAction(thread, action, 'Larry put this file on hold.');
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      owner: 'larry',
      digest_pending: false,
      next_follow_up_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }).catch(() => null);
    return { ok: true, tone: 'neutral', title: 'On hold', message: `${who} is paused. I will bring the file back in a week.` };
  }

  if (action === 'mark-shipped') {
    await recordLarryAction(thread, action, 'Larry posted the card.');
    const filed = await fileDeploymentForThread(thread.id).catch(() => null);
    await supersedeDraftsForThread(thread.id);
    const message = await createMessage({
      thread_id: thread.id,
      role: 'agent',
      channel: 'email',
      direction: 'outbound',
      action_type: 'shipped',
      subject: subjectWithToken('Your VillageServer card is on its way', thread),
      body: [
        `Hi ${app.name || 'there'},`,
        '',
        `Your card has been posted${trim(app.languages, 120) ? `, loaded in ${trim(app.languages, 120)}` : ''}.`,
        '',
        `Post can be slow, so please give it time to reach you. When it arrives, reply and let me know — and if you are able to send a photo of it being used, we would love to see it.`,
        '',
        `If it has not turned up after a few weeks, tell me and I will look into it.`,
        '',
        config().agentName,
        'VillageServer Initiative',
      ].join('\n'),
      from_email: config().agentEmail,
      to_email: [normalizeEmail(app.email)],
      status: 'draft',
      metadata: { reason: 'larry_action', action },
    });
    const sent = message ? await sendMessageById(message.id).catch(() => null) : null;
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: 'shipped',
      owner: 'laura',
      digest_pending: true,
      summary: `Card posted to ${who}. Waiting to hear that it arrived.`,
      // "Waiting to hear that it arrived" has to be something Laura actually
      // does. Post to these places takes weeks, so the check is set far out —
      // but it is set, and the deployment record's promise of rollout photos
      // now has something behind it.
      next_follow_up_at: daysFromNow(config().arrivalCheckDays),
    }).catch(() => null);

    // A card that actually went out is a story, and everything the write-up
    // needs is already on this file. File it now rather than asking anyone to
    // retype it later.
    const written = await ensurePostForThread(thread.id, { thread, app }).catch(() => null);
    await notifyLarryPosted(thread, app, written && written.post).catch(() => null);

    return {
      ok: true,
      tone: 'go',
      title: 'Filed and confirmed',
      message: `${who} has been told the card is on its way.`,
      detail: [
        filed && filed.already_exists ? 'It was already in the deployment log.' : 'I have added it to the deployment log.',
        written && written.post
          ? (written.post.published ? 'The write-up is live on the site.' : 'A write-up is filed and waiting for you to read it.')
          : '',
        'Check your email — I have asked you for the tracking number.',
      ].filter(Boolean).join(' '),
    };
  }

  if (action === 'add-tracking') {
    const tracking = trim(value, 120);
    if (!tracking) {
      return { ok: false, tone: 'neutral', title: 'Nothing entered', message: 'No tracking number was submitted, so nothing changed.' };
    }
    await recordLarryAction(thread, action, `Larry added tracking number ${tracking}.`);
    // If the tracking columns are missing the database has not had the latest
    // schema.sql run against it. The number still reaches the applicant — that
    // is the part that matters — but the page must not claim it was filed.
    const onThread = await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      tracking_number: tracking,
      digest_pending: true,
    }).catch(() => null);
    const onDeployment = await patchRows(`deployments?application_id=eq.${encodeURIComponent(String(app.id))}`, {
      tracking_number: tracking,
    }).catch(() => null);
    const stored = !!(onThread && onDeployment);
    await insertRow('agent_filing_items', {
      thread_id: thread.id,
      application_id: String(app.id),
      item_type: 'shipping',
      state: 'done',
      title: `Tracking number ${tracking}`,
      detail: 'Entered by Larry and sent on to the applicant.',
      completed_at: new Date().toISOString(),
      metadata: { tracking_number: tracking },
    }).catch(() => null);

    const note = await createMessage({
      thread_id: thread.id,
      role: 'agent',
      channel: 'email',
      direction: 'outbound',
      action_type: 'tracking_number',
      subject: subjectWithToken('Tracking for your VillageServer card', thread),
      body: [
        `Hi ${app.name || 'there'},`,
        '',
        `Here is the tracking number for your card:`,
        '',
        tracking,
        '',
        `Post to some places updates slowly, or not at all until it arrives, so do not worry if the number shows nothing for a while.`,
        '',
        `I will check in with you in a couple of weeks. If it turns up before then, just reply and tell me.`,
        '',
        config().agentName,
        'VillageServer Initiative',
      ].join('\n'),
      from_email: config().agentEmail,
      to_email: [normalizeEmail(app.email)],
      status: 'draft',
      metadata: { reason: 'larry_action', action, tracking_number: tracking },
    });
    const relayed = note ? await sendMessageById(note.id).catch(() => null) : null;
    const filedNote = stored
      ? `Saved to the deployment record as ${tracking}.`
      : `Note: I could not write it to the deployment record — run the latest supabase/schema.sql, then add it again to get it into the export.`;
    return relayed
      ? { ok: true, tone: 'go', title: 'Tracking sent', message: `${who} has the tracking number.`, detail: filedNote }
      : { ok: true, tone: 'neutral', title: 'Tracking not sent', message: `${tracking} was recorded, but the email to ${who} did not go out.`, detail: 'The note is drafted in the admin panel; send it from there.' };
  }

  if (action === 'skip-tracking') {
    await recordLarryAction(thread, action, 'Larry confirmed there is no tracking number for this one.');
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      digest_pending: true,
      summary: `Card posted to ${who} with no tracking number. Waiting to hear that it arrived.`,
    }).catch(() => null);
    return {
      ok: true,
      tone: 'neutral',
      title: 'Noted',
      message: 'No tracking number for this one.',
      detail: `Nothing was emailed. I will still check with ${who} in a couple of weeks.`,
    };
  }

  if (action === 'publish-post') {
    const post = await postForApplication(app.id);
    if (!post) {
      return { ok: false, tone: 'neutral', title: 'Nothing to publish', message: `There is no write-up filed for ${who}.`, detail: 'Write one in the admin panel instead.' };
    }
    if (post.published) {
      return { ok: true, repeat: true, tone: 'go', title: 'Already live', message: `"${post.title}" is already on the site.` };
    }
    await recordLarryAction(thread, action, `Larry published the write-up "${post.title}".`);
    await patchRows(`posts?id=eq.${encodeURIComponent(post.id)}`, {
      published: true,
      published_at: new Date().toISOString(),
    });
    return {
      ok: true,
      tone: 'go',
      title: 'Published',
      message: `"${post.title}" is live on the site.`,
      detail: 'You can still edit or unpublish it from the admin panel.',
    };
  }

  if (action === 'file-deployment') {
    await recordLarryAction(thread, action, 'Larry filed the deployment record.');
    const filed = await fileDeploymentForThread(thread.id).catch(() => null);
    return {
      ok: true,
      tone: 'go',
      title: filed && filed.already_exists ? 'Already filed' : 'Filed',
      message: `${who} is in the deployment log.`,
      detail: 'Nothing was emailed to them.',
    };
  }

  if (action === 'schedule-call') {
    const booking = config().calBookingUrl;
    if (!booking) {
      return {
        ok: false,
        tone: 'neutral',
        title: 'No booking link set',
        message: 'There is no scheduling link configured, so I cannot send one.',
        detail: 'Set LARRY_CAL_BOOKING_URL in Vercel, or reply to them directly.',
      };
    }
    await recordLarryAction(thread, action, 'Larry asked for a call before shipping.');
    await supersedeDraftsForThread(thread.id);
    const message = await createMessage({
      thread_id: thread.id,
      role: 'agent',
      channel: 'email',
      direction: 'outbound',
      action_type: 'send_schedule_link',
      subject: subjectWithToken('A quick call about your VillageServer card', thread),
      body: [
        `Hi ${app.name || 'there'},`,
        '',
        `Before we send anything out, Larry would like a short conversation with you about your work and how the card will be used.`,
        '',
        `Pick whatever time suits you here: ${booking}`,
        '',
        `If none of those times work, just reply and tell me what does.`,
        '',
        config().agentName,
        'VillageServer Initiative',
      ].join('\n'),
      from_email: config().agentEmail,
      to_email: [normalizeEmail(app.email)],
      status: 'draft',
      metadata: { reason: 'larry_action', action },
    });
    const sent = message ? await sendMessageById(message.id).catch(() => null) : null;
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: 'ready_to_schedule', owner: 'applicant', digest_pending: true,
      next_follow_up_at: new Date(Date.now() + config().followUpDays * 86400000).toISOString(),
    }).catch(() => null);
    return sent
      ? { ok: true, tone: 'go', title: 'Booking link sent', message: `${who} has your booking link.` }
      : { ok: false, tone: 'stop', title: 'Could not send', message: 'The booking link is drafted but did not go out.' };
  }

  if (action === 'decline') {
    if (String(app.status || '') === 'declined') {
      return { ok: true, repeat: true, tone: 'neutral', title: 'Already declined', message: `${who} was already declined.` };
    }
    await recordLarryAction(thread, action, 'Larry declined this application from the intake email.');
    await setApplicationStatus(app.id, 'declined');
    await supersedeDraftsForThread(thread.id);
    // A decline is never auto-sent. The wording matters too much to send it
    // from a button press without anyone reading it first.
    await createMessage({
      thread_id: thread.id,
      role: 'agent',
      channel: 'email',
      direction: 'outbound',
      action_type: 'close',
      subject: subjectWithToken('Your VillageServer application', thread),
      body: declineEmailBody(app),
      from_email: config().agentEmail,
      to_email: [normalizeEmail(app.email)],
      status: 'draft',
      metadata: { reason: 'larry_action', action },
    }).catch(() => null);
    await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
      state: 'closed', owner: 'larry', digest_pending: true, next_follow_up_at: null,
      summary: 'Larry declined. A note to the applicant is drafted and waiting for review.',
    }).catch(() => null);
    return {
      ok: true,
      tone: 'stop',
      title: 'Declined',
      message: `${who} is marked declined.`,
      detail: 'I have drafted a kind note to them but have not sent it — read it over in the admin panel first.',
    };
  }

  throw new Error('Unhandled action.');
}

// ── Follow-ups ──────────────────────────────────────────────────────────
//
// A receptionist who never chases is half a receptionist. Threads carry a
// next_follow_up_at; this runs the ones that are due, nudges the applicant a
// bounded number of times, then hands the file to Larry rather than nagging.

function nudgeDecision(app, thread, attempt) {
  const c = config();
  const missing = detectMissingFields(app);
  return {
    next_action: 'follow_up_nudge',
    state: 'waiting_on_customer',
    audience: 'applicant',
    missing_fields: missing,
    summary: `Follow-up ${attempt} sent to ${app.name || 'applicant'} with no reply yet.`,
    draft_subject: `Checking in on your VillageServer application`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      attempt === 1
        ? `I wanted to check in on your VillageServer application — I have not heard back yet and want to make sure my last note reached you.`
        : `Just one more note about your VillageServer application. I still have it open and would rather keep it moving than let it lapse.`,
      '',
      ...(missing.length ? ['If it helps, here is what I am still waiting on:', ...missing.map((field) => `- ${missingRequestFor(field)}`), ''] : []),
      `If now is not the right time, simply reply and tell me — I will set the file aside and you can come back to it whenever you are ready.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].join('\n'),
    reasoning: `Scheduled follow-up ${attempt} after no applicant reply.`,
    auto_send_ok: true,
  };
}

// Larry approved and the booking link went out, but nobody picked a time. This
// is still a nudge — same budget, same cooldown — it just cannot talk about
// missing form details, because there are none.
function bookingNudgeDecision(app, thread, attempt) {
  const c = config();
  return {
    next_action: 'follow_up_nudge',
    state: 'ready_to_schedule',
    audience: 'applicant',
    missing_fields: [],
    summary: `Booking reminder ${attempt} sent to ${app.name || 'applicant'} — no time picked yet.`,
    draft_subject: `Booking a time with VillageServer`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      `I sent over a link to book a time with Larry and have not seen a slot come through yet, so I wanted to check it reached you.`,
      ...(c.calBookingUrl ? ['', `Here it is again: ${c.calBookingUrl}`] : []),
      '',
      `If none of the times on there suit you, just reply and tell me roughly when you are usually free, and I will work around it.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].join('\n'),
    reasoning: `Scheduled booking reminder ${attempt} after no booking.`,
    auto_send_ok: true,
  };
}

// The last thing anyone hears about a card is usually Laura saying it has been
// posted. This is the note that closes that loop, and it asks for the three
// things the initiative actually needs back: did it get there, may we see it,
// and what has it made possible. Their answer goes into the write-up Laura
// already filed for them, so it is worth asking properly — but it takes "no" as
// a complete answer and never makes anyone feel audited.
function arrivalCheckDecision(app, thread, attempt) {
  const c = config();
  const language = trim(app && app.languages, 120);
  const tracking = trim(thread && thread.tracking_number, 120);
  return {
    next_action: 'request_rollout_photos',
    state: 'follow_up_photos',
    audience: 'applicant',
    missing_fields: [],
    summary: `Arrival check ${attempt} sent to ${app.name || 'applicant'} on a posted card.`,
    draft_subject: `Did your VillageServer card arrive?`,
    draft_body: [
      `Hi ${app.name || 'there'},`,
      '',
      attempt === 1
        ? `It has been a couple of weeks since your card${language ? ` in ${language}` : ''} went in the post, so I wanted to check whether it reached you.`
        : `I am still not sure whether your card ever reached you, and I would rather ask again than assume it did.`,
      ...(tracking ? ['', `The tracking number, if it helps: ${tracking}`] : []),
      '',
      `If it arrived, I would love to hear two things when you have a moment:`,
      `1. A photo or two of it being used — on a phone, in a gathering, however it looks where you are.`,
      `2. What you have been able to do with it. Who has heard it, how many, what has come of it.`,
      '',
      `We share those with the people who make these cards possible, and honestly nothing we write ourselves does the work half as well as one sentence from you. Only send what you are comfortable being shared, and if you would rather not, that is completely fine — just say so.`,
      '',
      `If it has not turned up, tell me and I will look into sending another.`,
      '',
      c.agentName,
      'VillageServer Initiative',
    ].join('\n'),
    reasoning: `Scheduled arrival check ${attempt} after posting.`,
    auto_send_ok: true,
  };
}

export async function runDueFollowUps({ limit = 25 } = {}) {
  if (!(await settingBool('laura_agent_enabled', true))) {
    return { ok: false, skipped: true, reason: 'Laura agent is disabled.' };
  }
  const c = config();
  const nowIso = new Date().toISOString();
  // Every state that can carry a follow-up clock, not just the intake ones.
  // approve and schedule-call arm `ready_to_schedule`, hold arms whatever the
  // file was in, and posting a card arms the arrival check — a clock nobody
  // reads is the same as no clock at all.
  const due = await selectRows(
    `intake_threads?select=*&next_follow_up_at=lte.${encodeURIComponent(nowIso)}`
    + `&state=in.(new,waiting_on_customer,waiting_on_larry,ready_to_schedule,shipped,follow_up_photos)`
    + `&order=next_follow_up_at.asc&limit=${Number(limit) || 25}`,
  ).catch(() => []);

  const results = [];
  for (const thread of due) {
    try {
      const app = await loadApplication(thread.application_id);
      if (!app) {
        await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, { next_follow_up_at: null });
        continue;
      }
      const messages = await messagesForThread(thread.id);
      const stage = String(thread.state || '');
      const posted = stage === 'shipped' || stage === 'follow_up_photos';

      // A file parked with Larry is never chased — the clock on it is the "bring
      // this back in a week" promise from the Hold button. Keeping that promise
      // means putting it back in his digest, not emailing the applicant.
      if (String(thread.owner || '') === 'larry') {
        await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
          next_follow_up_at: null,
          digest_pending: true,
          summary: `${thread.summary || `${app.name || 'Applicant'} was put on hold.`} Back on your list now.`,
        }).catch(() => null);
        results.push({ thread_id: thread.id, outcome: 'hold expired — back in the digest' });
        continue;
      }

      // A draft that never left is an unfinished run, not a silent applicant.
      // Re-running Laura re-decides against the file as it stands now and
      // retries the send, rather than nudging someone who has yet to hear from
      // us at all.
      const pendingDraft = asArray(messages).some((m) => m.status === 'draft' && m.direction === 'outbound');
      if (pendingDraft && !posted) {
        const run = await runLauraAgent({ threadId: thread.id, reason: 'retry_held_send' }).catch((e) => ({ held: String((e && e.message) || e) }));
        results.push({ thread_id: thread.id, outcome: run && run.sent ? 'held draft sent on retry' : `still held (${(run && run.held) || 'unknown'})` });
        continue;
      }

      // Silence only means silence if Laura can hear. With no inbound channel
      // an applicant who answered looks identical to one who never replied, and
      // chasing them for details they already sent is the worst thing she can
      // do. Hand the file to Larry and say plainly why.
      if (!inboundConfigured()) {
        // Except after posting: there is no decision waiting on him, only a
        // mailbox nobody has read. Say so and stop the clock.
        if (posted) {
          await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
            next_follow_up_at: null,
            digest_pending: true,
            summary: `Card posted to ${app.name || 'the applicant'}. Cannot check whether it arrived — Gmail is not connected, so check the ${c.agentEmail} inbox by hand.`,
          }).catch(() => null);
          results.push({ thread_id: thread.id, outcome: 'arrival check skipped — no inbound channel' });
          continue;
        }
        await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
          state: 'waiting_on_larry',
          owner: 'larry',
          next_follow_up_at: null,
          digest_pending: true,
          summary: `${app.name || 'Applicant'} has not replied as far as I can tell — but Gmail is not connected, so I cannot see replies. Check the ${c.agentEmail} inbox by hand.`,
        }).catch(() => null);
        results.push({ thread_id: thread.id, outcome: 'handed to Larry — no inbound channel to hear replies' });
        continue;
      }

      // They replied since the nudge was scheduled — nothing to chase.
      if (!applicantWentQuiet(messages)) {
        await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, { next_follow_up_at: null });
        results.push({ thread_id: thread.id, outcome: 'applicant already replied' });
        continue;
      }

      // Three different silences, three different letters. Chasing a posted
      // card with "here is what I am still waiting on" would be nonsense, and
      // so would chasing a booking with intake questions.
      const attempts = posted
        ? sentActionCount(messages, 'request_rollout_photos')
        : nudgeCount(messages);
      const cap = posted ? c.maxArrivalChecks : c.maxNudges;

      if (attempts >= cap) {
        // A card that was posted and never acknowledged is not a decision for
        // Larry — it is simply a file that has run its course. Close it rather
        // than adding it to his pile.
        const done = posted
          ? {
            state: 'closed',
            owner: 'laura',
            summary: `Card posted to ${app.name || 'the applicant'}, no word back after ${attempts} checks. Closing the file; the deployment record stands.`,
          }
          : {
            state: 'waiting_on_larry',
            owner: 'larry',
            summary: `${app.name || 'Applicant'} has not replied after ${attempts} follow-ups. Needs your call on whether to close the file.`,
          };
        await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
          ...done,
          next_follow_up_at: null,
          digest_pending: true,
        }).catch(() => null);
        results.push({
          thread_id: thread.id,
          outcome: posted ? 'closed after arrival checks went unanswered' : 'handed to Larry after max nudges',
        });
        continue;
      }

      const attempt = attempts + 1;
      const decision = posted ? arrivalCheckDecision(app, thread, attempt)
        : stage === 'ready_to_schedule' ? bookingNudgeDecision(app, thread, attempt)
          : nudgeDecision(app, thread, attempt);
      const message = await createMessage({
        thread_id: thread.id,
        role: 'agent',
        channel: 'email',
        direction: 'outbound',
        action_type: decision.next_action,
        subject: subjectWithToken(decision.draft_subject, thread),
        body: decision.draft_body,
        from_email: c.agentEmail,
        to_email: [normalizeEmail(app.email)],
        status: 'draft',
        metadata: { decision, reason: posted ? 'arrival_check' : 'follow_up', attempt },
      });

      const gate = await autoSendGate({ decision, messages, outbound: true, audience: 'applicant' });
      let sent = null;
      if (message && gate.allowed) sent = await sendMessageById(message.id).catch(() => null);

      // Re-arm on success at the cadence this kind of chase deserves; on a hold,
      // look again in a day once the cooldown has had time to clear.
      const nextInDays = sent ? (posted ? c.arrivalCheckDays : c.followUpDays) : 1;
      await patchRows(`intake_threads?id=eq.${encodeURIComponent(thread.id)}`, {
        summary: decision.summary,
        digest_pending: true,
        last_agent_run_at: new Date().toISOString(),
        next_follow_up_at: daysFromNow(nextInDays),
        ...(sent && posted ? { state: 'follow_up_photos' } : {}),
      }).catch(() => null);

      const label = posted ? `arrival check ${attempt}` : `nudge ${attempt}`;
      results.push({
        thread_id: thread.id,
        outcome: sent ? `${label} sent` : `${label} drafted (${gate.reason})`,
      });
    } catch (e) {
      results.push({ thread_id: thread.id, error: String((e && e.message) || e) });
    }
  }
  return { ok: true, due: due.length, results };
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

// Mail clients quote the entire prior thread under the new reply. Left alone,
// every round-trip re-imports the whole conversation into the row and then into
// the prompt, and Laura starts reading her own old questions as if they were
// new. Keep only what the person actually typed this time.
const QUOTE_MARKERS = [
  /^\s*On .{0,120}\b(wrote|schrieb|a écrit)\s*:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.+\bSent:\s/ims,
  /^\s*>{1,}\s?.*$/m,
  /^\s*Sent from my \w+/im,
];

export function stripQuotedReply(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const found = text.search(marker);
    if (found > -1 && found < cut) cut = found;
  }
  const kept = text.slice(0, cut).trim();
  // If stripping ate the whole message the markers misfired — keep the original.
  return kept.length >= 2 ? kept : text.trim();
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
    body: trim(stripQuotedReply(body) || message.snippet || '', 8000),
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
        // Either way the ball is back with Laura: she carries out Larry's
        // instruction, or she processes the applicant's reply.
        owner: 'laura',
        digest_pending: true,
        // An inbound message answers any pending chase.
        next_follow_up_at: null,
        gmail_thread_id: parsed.gmail_thread_id || thread.gmail_thread_id || null,
        last_customer_message_at: fromLarry ? thread.last_customer_message_at : new Date().toISOString(),
        last_larry_message_at: fromLarry ? new Date().toISOString() : thread.last_larry_message_at,
      });
      if (autoRun) {
        await runLauraAgent({
          threadId: thread.id,
          reason: fromLarry ? 'larry_reply' : 'customer_reply',
        }).catch((e) => ({ error: e.message }));
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

// ── The write-up Laura files for every shipped applicant ────────────────
//
// One post per applicant who is approved and actually gets something sent. All
// the material is already on the application — who they are, where they serve,
// what language, how many people — so rather than have that retyped, Laura
// writes it up when the card is posted and adds their own words to the same
// post when they write back. A deployment ends as a story, not a row in a log.
//
// Not a fundraiser: no donation link, no goal, no money. Just the account of
// where a card went and what it is for.

function postDraftFrom(app) {
  const where = [app.region, app.country].filter(Boolean).join(', ');
  const who = trim(app.organization, 120) || trim(app.name, 120) || 'a field partner';
  const languages = trim(app.languages, 160);
  const reach = trim(app.current_reach, 80);

  const body = [
    `${who}${where ? ` serves in ${where}` : ''}${reach ? `, reaching around ${reach} people` : ''}.`,
    languages
      ? `A microSD card is on its way to them, loaded with the offline library in ${languages} — Scripture, audio Bible, gospel films and teaching material that works on an ordinary phone with no internet at all.`
      : `A microSD card is on its way to them, loaded with the offline library — Scripture, audio Bible, gospel films and teaching material that works on an ordinary phone with no internet at all.`,
    trim(app.mission_context, 900) || '',
    trim(app.reach_justification, 600) || '',
    `Once a card reaches a community it can be copied on to other phones, so it keeps going long after the post arrives.`,
  ].filter(Boolean).join('\n\n');

  return {
    title: trim(`${where || 'Field'} — ${who}`, 160),
    body,
    author: 'VillageServer Initiative',
    // Off by default. These posts name a real person, their church and where
    // they are, and for some fields that is not information to put on a public
    // site without a human looking first. Set LAURA_AUTO_PUBLISH_POSTS=true if
    // every applicant you serve is somewhere that is safe to name.
    published: env('LAURA_AUTO_PUBLISH_POSTS').toLowerCase() === 'true',
    auto_created: true,
    source_application_id: String(app.id),
  };
}

// When someone writes back about a card that reached them, that message is the
// most valuable thing the initiative will get all week. It goes into the write-up
// Laura already filed for this applicant rather than becoming a second post —
// one applicant, one story, which is also what makes it safe to append to
// repeatedly without the site filling up with fragments.
//
// Their words are quoted, not paraphrased, and never published by this path even
// when auto-publish is on: a write-up Laura composed from a form is one thing,
// and somebody else's account of their own ministry is another.
async function appendReplyToWriteUp(thread, app, messages) {
  const reply = asArray(messages)
    .filter((m) => m.role === 'applicant' && m.direction === 'inbound')
    .slice(-1)[0];
  if (!reply || !trim(reply.body, 40)) return null;

  const already = await selectRows(
    `agent_filing_items?select=id&thread_id=eq.${encodeURIComponent(thread.id)}`
    + `&item_type=eq.field_update&metadata->>source_message_id=eq.${encodeURIComponent(String(reply.id))}&limit=1`,
  ).catch(() => []);
  if (already.length) return null;

  const post = await postForApplication(app.id);
  if (!post) return null;

  const stamp = new Date().toISOString().slice(0, 10);
  const appended = [
    trim(post.body, 12000),
    '',
    `Update from ${trim(app.name, 120) || 'the field'}, ${stamp}:`,
    '',
    trim(reply.body, 3000),
  ].join('\n');

  const updated = await patchRows(`posts?id=eq.${encodeURIComponent(post.id)}`, {
    body: appended,
    // Their own words go back to unpublished for a read, whatever the post was
    // before. Auto-publish covers what Laura writes, not what someone else said.
    published: false,
  }).catch(() => null);
  if (!updated) return null;

  await insertRow('agent_filing_items', {
    thread_id: thread.id,
    application_id: String(app.id),
    item_type: 'field_update',
    state: 'pending',
    title: `${app.name || 'The applicant'} wrote back — added to their write-up`,
    detail: 'Their own words, waiting for you to read them before the post goes public.',
    metadata: { post_id: post.id, source_message_id: reply.id },
  }).catch(() => null);
  return post;
}

async function postForApplication(applicationId) {
  const rows = await selectRows(
    `posts?select=*&source_application_id=eq.${encodeURIComponent(String(applicationId))}&limit=1`,
  ).catch(() => []);
  return rows[0] || null;
}

// Idempotent: a second posting of the same file finds the write-up that already
// exists rather than cluttering the admin panel with duplicates.
export async function ensurePostForThread(threadId, { thread = null, app = null } = {}) {
  const t = thread || await loadThreadBy({ threadId });
  if (!t) throw new Error('Thread not found.');
  const a = app || await loadApplication(t.application_id);
  if (!a) throw new Error('Application not found.');

  const existing = await postForApplication(a.id);
  if (existing) return { ok: true, already_exists: true, post: existing };

  const post = await insertRow('posts', postDraftFrom(a)).catch(() => null);
  if (!post) return { ok: false, post: null };

  await insertRow('agent_filing_items', {
    thread_id: t.id,
    application_id: String(a.id),
    item_type: 'post',
    state: post.published ? 'done' : 'pending',
    title: `Write-up filed: ${post.title}`,
    detail: post.published
      ? 'Written from the application and published.'
      : 'Written from the application and waiting for you to read it before it goes public.',
    ...(post.published ? { completed_at: new Date().toISOString() } : {}),
    metadata: { post_id: post.id, auto_created: true },
  }).catch(() => null);

  return { ok: true, post };
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
    monetary_support: trim(app.funding_needed, 240) || null,
    language_card: trim(app.languages, 240) || null,
    additional_notes: [
      `Filed by Laura from application ${app.id}.`,
      thread.summary ? `Thread summary: ${thread.summary}` : '',
      `Requested kit: ${kitLabel(app)}`,
      app.receiving_plan ? `Receiving plan: ${app.receiving_plan}${app.receiving_plan_details ? ` - ${app.receiving_plan_details}` : ''}` : '',
      app.shipping_address ? `Shipping address / delivery destination: ${app.shipping_address}` : '',
      app.funding_needed ? `Funding requested: ${app.funding_needed}` : '',
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
  const gmailClientConfigured = !!(env('GMAIL_CLIENT_ID') && env('GMAIL_CLIENT_SECRET'));
  const gmailRefreshConfigured = !!env('GMAIL_REFRESH_TOKEN');
  return {
    autonomy: await autonomyLevel(),
    action_links_configured: !!(env('LAURA_ACTION_SECRET') || env('ADMIN_PASSWORD')),
    site_url: siteBaseUrl(),
    offer_mode: offerMode(),
    cooldown_hours: c.cooldownHours,
    follow_up_days: c.followUpDays,
    max_nudges: c.maxNudges,
    max_ask_rounds: c.maxAskRounds,
    arrival_check_days: c.arrivalCheckDays,
    max_arrival_checks: c.maxArrivalChecks,
    // Laura can only run the loop unattended if she can hear replies at all.
    // Without Gmail she still writes, but every silence is ambiguous and files
    // get handed to Larry instead of chased.
    inbound_configured: inboundConfigured(),
    supabase_configured: !!(c.supabaseUrl && c.supabaseKey),
    anthropic_configured: !!c.anthropicKey,
    resend_configured: !!c.resendKey,
    gmail_client_configured: gmailClientConfigured,
    gmail_refresh_configured: gmailRefreshConfigured,
    gmail_oauth_configured: !!(gmailClientConfigured && gmailRefreshConfigured),
    gmail_user: c.gmailUser,
    email_provider: c.emailProvider,
    agent_email: c.agentEmail,
    larry_email: c.larryEmail,
    cal_booking_configured: !!c.calBookingUrl,
  };
}
