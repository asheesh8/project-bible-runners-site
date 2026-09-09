// /api/track.js — Visit tracking + donation interest capture + contact form
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD, RESEND_API_KEY, CONTACT_FROM_EMAIL, NOTIFY_EMAIL
//
// Public (no auth):
//   POST /api/track?type=visit        { visitor_id, site_host, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid }
//   POST /api/track?type=click        { visitor_id, site_host, path, link_url, link_text, link_type }
//   POST /api/track?type=interest     { visitor_id, site_host, name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign }
//   POST /api/track?type=contact      { visitor_id, site_host, name, email, message } — emails the team via Resend
//   POST /api/track?type=application  full intake payload — triaged, stored, emails team + applicant
//
// Admin (Authorization: Bearer <signed token from /api/auth>):
//   GET    /api/track?type=visits | interests | contacts | applications | deployments | summary
//   PATCH  /api/track?type=applications&id=…   { status?, admin_notes? }
//   POST   /api/track?type=deployments         deployment record
//   PATCH  /api/track?type=deployments&id=…    partial deployment record
//   DELETE /api/track?type=applications|deployments&id=…
import { isAuthorizedAdmin } from './_lib/admin-token.js';
import { ensureThreadForApplication, runLauraAgent } from './_lib/laura-agent.js';

const ROBOT_USER_AGENT_RE = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|google-inspectiontool|googleother|adsbot|mediapartners-google|apis-google|feedfetcher|monitor|uptime|pingdom|headlesschrome|phantomjs|lighthouse|pagespeed|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|yandex|baiduspider|duckduckbot|archive\.org|wget|curl|python-requests|httpclient/i;

function trimText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function readGeo(req) {
  return {
    country: trimText(req.headers['x-vercel-ip-country'] || req.headers['x-country'] || '', 8).toUpperCase() || null,
    region: trimText(req.headers['x-vercel-ip-country-region'] || req.headers['x-region'] || '', 80) || null,
    city: trimText(req.headers['x-vercel-ip-city'] || req.headers['x-city'] || '', 120) || null,
  };
}

function detectRobotRequest(req) {
  const userAgent = trimText(req.headers['user-agent'], 500);
  const purpose = trimText(req.headers.purpose || req.headers['sec-purpose'] || req.headers['x-purpose']).toLowerCase();
  const secFetchSite = trimText(req.headers['sec-fetch-site']).toLowerCase();

  if (ROBOT_USER_AGENT_RE.test(userAgent)) return `known crawler: ${userAgent.slice(0, 90)}`;
  if (purpose.includes('prefetch') || purpose.includes('preview') || purpose.includes('prerender')) return `browser preview: ${purpose.slice(0, 90)}`;
  if (secFetchSite === 'none' && /preview|bot|crawler/i.test(userAgent)) return `automated fetch: ${userAgent.slice(0, 90)}`;
  return '';
}

function exactCountFrom(response) {
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

async function jsonOrEmpty(response) {
  try {
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function fetchWithFallback(attempts) {
  let lastResponse = null;
  for (const attempt of attempts) {
    lastResponse = await fetch(attempt.url, attempt.options);
    if (lastResponse.ok || lastResponse.status === 206) return lastResponse;
  }
  return lastResponse;
}

async function sendContactEmail({ name, email, message, site_host }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || 'VillageServer Initiative <onboarding@resend.dev>',
        to: ['villageserverinitiative@gmail.com'],
        reply_to: email,
        subject: `New website contact message${name ? ` from ${name}` : ''}`,
        text: `Name: ${name || '—'}\nEmail: ${email}\nSite: ${site_host || '—'}\n\n${message}`,
      }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// ── Application intake: triage scoring ──────────────────────────────
// Rule-based, never auto-rejects. Produces verification flags, a 0-3
// score, a Low/Medium/High confidence tag, a tier/audience mismatch
// flag, and a plain-English note explaining the result for Eric.
const FREEMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'zoho.com', 'rediffmail.com', 'qq.com', '163.com', '126.com']);

const KIT_TIERS = {
  1: 'microSD card', 2: 'Wi-Fi sharing hub', 3: 'Raspberry Pi VillageServer',
  4: 'Projector & audio', 5: 'Satellite receive-and-replay',
};
const AUDIENCE_LABELS = {
  individual: 'individual', small_group: 'small group under 20',
  village_congregation: 'village / congregation', regional_network: 'multi-village / regional network',
};

function emailDomainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at === -1 ? '' : String(email).slice(at + 1).toLowerCase().trim();
}

function websiteDomainOf(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// Uploaded evidence arrives as a data URL. Anything that is not an image or a
// PDF, or is over the cap, is dropped rather than rejected — a bad upload must
// never cost an applicant the whole application they just spent ten minutes on.
const DATA_URL_RE = /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,[a-zA-Z0-9+/=]+$/;

function cleanDataUrl(value, maxLen = 2200000) {
  return (typeof value === 'string' && DATA_URL_RE.test(value) && value.length <= maxLen) ? value : null;
}

// At most 3 ministry photos, each within the cap, names trimmed.
function cleanPhotoArray(value, maxItems = 3) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => {
    const data = cleanDataUrl(item && item.data);
    if (!data) return null;
    return { name: trimText(item && item.name, 200) || 'photo', data };
  }).filter(Boolean);
}

// ── Proof of ministry ────────────────────────────────────────────────
// Larry's rule: nobody is reviewed until we know the ministry is real. Five
// signals count — referrals, a government photo ID, pastoral licensing or
// authorization, ministry/service photos, and an interview with Laura.
//
// The exemption exists because the requirement cannot be absolute. In parts of
// the field, carrying ordination papers or photographing a service is what gets
// a pastor arrested. Those applicants verify through people instead of paper:
// two independent referees and a live interview, which is a higher bar of
// human contact, not a waiver. What we never do is quietly downgrade them —
// the file says which route they took and why.
export function computeVerification(app) {
  const mode = app.ministry_verification_mode === 'safety_exempt' ? 'safety_exempt' : 'documents';
  const exempt = mode === 'safety_exempt';

  const referees = [
    !!(app.reference_name && app.reference_contact),
    !!(app.reference2_name && app.reference2_contact),
  ].filter(Boolean).length;
  const hasId = !!app.id_document;
  const hasLicense = !!(app.license_document || (app.ministry_license_body && app.ministry_license_ref));
  const photoCount = Array.isArray(app.ministry_photos) ? app.ministry_photos.length : 0;
  const interviewAgreed = app.interview_consent === true;

  // The exemption path trades documents for people, so it needs both referees.
  const refereesEnough = exempt ? referees >= 2 : referees >= 1;

  const score = [refereesEnough, exempt || hasId, exempt || hasLicense, exempt || photoCount > 0, interviewAgreed]
    .filter(Boolean).length;

  const gaps = [];
  if (!refereesEnough) gaps.push(exempt ? 'two independent referees' : 'a reference contact');
  if (!exempt && !hasId) gaps.push('government-issued photo ID');
  if (!exempt && !hasLicense) gaps.push('pastoral licensing or authorization');
  if (!exempt && !photoCount) gaps.push('ministry or service photos');
  if (!interviewAgreed) gaps.push('agreement to an interview with Laura');

  // The interview is always required — it is the one check no document
  // replaces — so a complete file is "interview_required", never "verified".
  // Only a human marking the interview done moves it on.
  const complete = gaps.length === 0;
  const status = !complete ? 'pending_review' : 'interview_required';

  const note = [
    `Ministry verification ${score}/5 via the ${exempt ? 'safety-exemption' : 'document'} route.`,
    exempt
      ? `Applicant states documents cannot be sent safely: ${String(app.safety_exempt_reason || 'no reason given').slice(0, 240)}`
      : `Supplied: ${[hasId && 'photo ID', hasLicense && 'licensing', photoCount && `${photoCount} ministry photo${photoCount > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'nothing yet'}.`,
    `Referees on file: ${referees}.`,
    complete
      ? 'File is complete — the interview with Laura is the remaining gate.'
      : `Still needed: ${gaps.join(', ')}.`,
  ].join('\n');

  return {
    ministry_verification_mode: mode,
    verification_score: score,
    verification_status: status,
    verification_note: note,
    interview_status: 'required',
    verification_gaps: gaps,
  };
}

function computeTriage(app) {
  const eDom = emailDomainOf(app.email);
  const wDom = websiteDomainOf(app.org_website);
  const domainMatch = !!(eDom && ((wDom && (eDom === wDom || eDom.endsWith('.' + wDom))) || (app.organization && !FREEMAIL_DOMAINS.has(eDom))));
  const referenceProvided = !!(app.reference_name && app.reference_contact);
  const webPresence = !!wDom;
  const score = (domainMatch ? 1 : 0) + (referenceProvided ? 1 : 0) + (webPresence ? 1 : 0);

  const tier = Number(app.kit_tier) || null;
  const smallAudience = app.audience_type === 'individual' || app.audience_type === 'small_group';
  const flags = [];
  if (tier >= 4 && smallAudience) flags.push('tier_audience_mismatch');

  // Verification is a gate, not a scoring input: however strong the rest of the
  // file looks, an unverified ministry does not skip the queue.
  const verificationScore = Number(app.verification_score);
  const verificationComplete = Number.isFinite(verificationScore) && verificationScore >= 5;
  if (!verificationComplete) flags.push('ministry_unverified');

  const confidence = score >= 3 ? 'High' : score === 2 ? 'Medium' : 'Low';
  const fastTrack = confidence === 'High' && tier >= 1 && tier <= 3
    && verificationComplete && flags.filter((f) => f !== 'ministry_unverified').length === 0;

  const notes = [];
  notes.push(`Verification ${score}/3 — ` + [
    domainMatch
      ? (wDom && (eDom === wDom || eDom.endsWith('.' + wDom))
        ? `email domain (@${eDom}) matches the listed website`
        : `email domain (@${eDom}) looks organizational`)
      : `email domain (@${eDom || '—'}) is personal/free and does not match a listed website`,
    referenceProvided ? 'reference contact provided' : 'no reference contact',
    webPresence ? `web presence listed (${wDom})` : 'no website or social link given',
  ].join('; ') + '.');
  if (tier) {
    const tierLine = `Requested tier ${tier} (${KIT_TIERS[tier] || 'unknown'}) for audience "${AUDIENCE_LABELS[app.audience_type] || app.audience_type || 'not stated'}"` +
      (app.frequency_of_use ? `, use: ${String(app.frequency_of_use).replace(/_/g, ' ')}` : '');
    if (flags.includes('tier_audience_mismatch')) {
      notes.push(`${tierLine} — MISMATCH: a large-reach kit was requested for a small audience. Routed to manual review.`);
    } else {
      notes.push(`${tierLine} — tier and audience are consistent.`);
    }
  }
  if (app.verification_note) notes.push(String(app.verification_note));
  notes.push(fastTrack
    ? 'Fast-track candidate: verified ministry, high confidence, low-cost tier (1-3).'
    : !verificationComplete ? 'Blocked from fast-track: ministry verification is incomplete.'
      : flags.length ? 'Needs manual review before any approval.' : `Standard review (${confidence.toLowerCase()} confidence).`);

  return {
    email_domain_match: domainMatch,
    reference_provided: referenceProvided,
    web_presence_found: webPresence,
    triage_score: score,
    triage_confidence: confidence,
    triage_flags: flags,
    triage_note: notes.join('\n'),
    fast_track: fastTrack,
  };
}

async function sendApplicationEmails({ app, triage }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.CONTACT_FROM_EMAIL || 'VillageServer Initiative <onboarding@resend.dev>';
  const teamEmail = process.env.NOTIFY_EMAIL || process.env.LARRY_EMAIL || 'villageserverinitiative@gmail.com';
  const agentEmail = process.env.AGENT_EMAIL || teamEmail;
  const tierLabel = app.kit_tier ? `Tier ${app.kit_tier} — ${KIT_TIERS[app.kit_tier] || ''}` : 'No tier selected';
  const teamBody = [
    `New VillageServer application`,
    ``,
    `Name: ${app.name}`,
    `Organization: ${app.organization || '—'}`,
    `Email: ${app.email}`,
    `Phone: ${[app.phone_country_code, app.phone].filter(Boolean).join(' ') || '—'}`,
    `Country: ${app.country}${app.region ? `, ${app.region}` : ''}`,
    `Building toward: ${tierLabel}`,
    `Funnel: ${app.funnel === 'kenya_schools' ? 'Kenya schools campaign' : 'main site'}`,
    `Shipping address / delivery destination: ${app.shipping_address || '—'}`,
    `Timeframe: ${app.timeframe || '—'}`,
    ``,
    `── Ministry verification: ${app.verification_score || 0}/5 · ${String(app.verification_status || 'unverified').replace(/_/g, ' ')} ──`,
    `Route: ${app.ministry_verification_mode === 'safety_exempt' ? 'SAFETY EXEMPTION — no documents, verify by referees + interview' : 'documents'}`,
    `Photo ID: ${app.id_document ? 'attached' : '—'} · Licensing: ${app.license_document ? 'attached' : (app.ministry_license_body || '—')} · Ministry photos: ${(app.ministry_photos || []).length}`,
    `Referee 1: ${app.reference_name || '—'} (${app.reference_relationship || 'relationship not stated'}) — ${app.reference_contact || '—'}`,
    `Referee 2: ${app.reference2_name || '—'} (${app.reference2_relationship || 'relationship not stated'}) — ${app.reference2_contact || '—'}`,
    `Interview: ${app.interview_consent ? 'agreed' : 'NOT agreed'}${app.interview_availability ? ` · availability: ${app.interview_availability}` : ''}`,
    ``,
    `── Triage: ${triage.triage_confidence} confidence${triage.fast_track ? ' · FAST-TRACK CANDIDATE' : ''}${triage.triage_flags.length ? ' · FLAGGED' : ''} ──`,
    triage.triage_note,
    ``,
    `Review it in the admin panel → https://villageserver.org/admin`,
  ].join('\n');
  const applicantBody = [
    `Hi ${app.name},`,
    ``,
    `Thank you for applying to the VillageServer Initiative. Your application has been received and our team reviews every one personally — we reply by email.`,
    ``,
    `Two things worth knowing now, so nothing comes as a surprise later:`,
    ``,
    `What we send is a microSD card loaded with the offline library, and an SD card adapter so it fits a phone or a reader. That is the whole of it today — the phones, servers, projectors, televisions, and satellite equipment that can be built around the card are things you would obtain locally yourself.`,
    ``,
    `Before anything ships, Laura will arrange a short interview with you. That conversation is part of how we verify every ministry we send to, and she will write to you about arranging it.`,
    ``,
    `Mission country: ${app.country}`,
    ``,
    `If you need to add anything to your application, just reply to this email.`,
    ``,
    `— The VillageServer Initiative team`,
  ].join('\n');
  const send = (msg) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(msg),
  }).then((r) => r.ok).catch(() => false);
  const results = await Promise.all([
    send({ from, to: [teamEmail], reply_to: app.email, subject: `New application — ${app.name} (${app.country}) — ${triage.triage_confidence} confidence`, text: teamBody }),
    send({ from, to: [app.email], reply_to: agentEmail, subject: 'We received your VillageServer application', text: applicantBody }),
  ]);
  return results[0] || results[1];
}

export default async function handler(req, res) {
  // Accept either our own names or the ones the Supabase–Vercel integration creates.
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;
  const VALID = ['visit', 'visits', 'click', 'clicks', 'interest', 'interests', 'availability', 'availabilities', 'contact', 'contacts', 'application', 'applications', 'deployment', 'deployments', 'setting', 'summary', 'health'];
  if (!VALID.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  // ── Admin health check: report pipeline status without exposing secrets ──
  if (type === 'health') {
    if (!isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
    const out = { supabase_configured: configured, admin_password_set: !!process.env.ADMIN_PASSWORD, tables: {}, visit_count: null, latest_visit_at: null };
    if (!configured) return res.status(200).json(out);
    const probeH = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
    for (const t of ['page_visits', 'link_clicks', 'donation_interests', 'availability_requests']) {
      try {
        const rr = (t === 'page_visits' || t === 'link_clicks')
          ? await fetchWithFallback([
            { url: `${SUPABASE_URL}/rest/v1/${t}?select=id&is_robot=not.is.true`, options: { headers: { ...probeH, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' } },
            { url: `${SUPABASE_URL}/rest/v1/${t}?select=id`, options: { headers: { ...probeH, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' } },
          ])
          : await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=id`, { headers: { ...probeH, Prefer: 'count=exact', Range: '0-0' } });
        if (rr.ok || rr.status === 206) {
          const cr = rr.headers.get('content-range') || '';
          const cnt = cr.includes('/') ? Number(cr.split('/')[1]) : null;
          out.tables[t] = { ok: true, count: Number.isFinite(cnt) ? cnt : null };
        } else {
          const body = await rr.json().catch(() => ({}));
          out.tables[t] = { ok: false, error: body.message || body.error || `HTTP ${rr.status}` };
        }
      } catch (e) {
        out.tables[t] = { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (out.tables.page_visits && out.tables.page_visits.ok) {
      out.visit_count = out.tables.page_visits.count;
      try {
        const lv = await fetchWithFallback([
          { url: `${SUPABASE_URL}/rest/v1/page_visits?select=created_at&is_robot=not.is.true&order=created_at.desc&limit=1`, options: { headers: probeH, cache: 'no-store' } },
          { url: `${SUPABASE_URL}/rest/v1/page_visits?select=created_at&order=created_at.desc&limit=1`, options: { headers: probeH, cache: 'no-store' } },
        ]);
        const arr = await lv.json();
        out.latest_visit_at = Array.isArray(arr) && arr[0] ? arr[0].created_at : null;
      } catch (e) { /* ignore */ }
    }
    return res.status(200).json(out);
  }

  // ── Public GET: read a site setting flag (e.g. applications_open) ──
  // Placed before the Supabase-configured guard so the page degrades to a
  // safe default (false) when the backend is not wired up yet.
  if (req.method === 'GET' && type === 'setting') {
    const key = String(req.query.key || '').replace(/[^a-z0-9_]/gi, '').slice(0, 60);
    if (!key) return res.status(400).json({ error: 'key is required' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(200).json({ key, value: false });
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?select=value&key=eq.${encodeURIComponent(key)}`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        cache: 'no-store',
      });
      const rows = await jsonOrEmpty(r);
      return res.status(200).json({ key, value: rows.length ? rows[0].value : false });
    } catch (e) {
      return res.status(200).json({ key, value: false });
    }
  }

  // ── Public POST: contact form — emails the team and stores a copy ──
  // Handled before the Supabase-configured check below so the email still
  // sends even on a deploy where Supabase hasn't been wired up yet.
  if (req.method === 'POST' && type === 'contact') {
    const { visitor_id, site_host, name, email, message } = req.body || {};
    const cleanEmail = trimText(email, 255);
    const cleanMessage = trimText(message, 4000);
    const cleanName = trimText(name, 160);
    if (!cleanEmail || !cleanMessage) return res.status(400).json({ error: 'email and message are required' });

    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);

    let stored = false;
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const sbHeaders = { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
      const payload = { visitor_id: cleanVisitorId || null, site_host: cleanHost, name: cleanName, email: cleanEmail, message: cleanMessage };
      const legacyPayload = (() => { const p = { ...payload }; delete p.visitor_id; delete p.site_host; return p; })();
      const r = await fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/contact_messages`, options: { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload) } },
        { url: `${SUPABASE_URL}/rest/v1/contact_messages`, options: { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(legacyPayload) } },
      ]);
      stored = !!(r && r.ok);
    }

    const emailed = await sendContactEmail({ name: cleanName, email: cleanEmail, message: cleanMessage, site_host: cleanHost });
    return res.status(200).json({ ok: true, stored, emailed });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    if (req.method === 'GET') return res.status(200).json([]);
    return res.status(200).json({ ok: true, note: 'Supabase not configured — tracking skipped' });
  }

  const sbH = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── Public POST: log visit ───────────────────────────────────────
  if (req.method === 'POST' && type === 'visit') {
    const { visitor_id, site_host, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid } = req.body || {};
    const robotReason = detectRobotRequest(req);
    if (robotReason) {
      return res.status(200).json({ ok: true, ignored: true, robot: true, reason: robotReason });
    }

    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);
    const geo = readGeo(req);
    const payload = {
      visitor_id: cleanVisitorId || null,
      site_host: cleanHost,
      path: trimText(path, 600),
      referrer: trimText(referrer, 1000),
      utm_source: trimText(utm_source),
      utm_medium: trimText(utm_medium),
      utm_campaign: trimText(utm_campaign),
      utm_content: trimText(utm_content),
      utm_term: trimText(utm_term),
      fbclid: trimText(fbclid, 500),
      ttclid: trimText(ttclid, 500),
      user_agent: trimText(req.headers['user-agent'], 500) || null,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      is_robot: false,
      robot_reason: null,
    };
    const legacyPayload = (() => {
      const p = { ...payload };
      delete p.country;
      delete p.region;
      delete p.city;
      delete p.user_agent;
      delete p.is_robot;
      delete p.robot_reason;
      return p;
    })();
    const payloads = [
      payload,
      legacyPayload,
      (() => { const p = { ...legacyPayload }; delete p.visitor_id; return p; })(),
      (() => { const p = { ...legacyPayload }; delete p.site_host; return p; })(),
      (() => { const p = { ...legacyPayload }; delete p.visitor_id; delete p.site_host; return p; })(),
    ];
    let visitResponse;
    // Keep tracking alive during short windows before visitor_id/site_host migrations are applied.
    for (const candidate of payloads) {
      visitResponse = await fetch(`${SUPABASE_URL}/rest/v1/page_visits`, {
        method: 'POST',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify(candidate),
      });
      if (visitResponse.ok) break;
    }
    return res.status(visitResponse.ok ? 200 : 502).json({ ok: visitResponse.ok });
  }

  // ── Public POST: log link click ──────────────────────────────────
  if (req.method === 'POST' && type === 'click') {
    const { visitor_id, site_host, path, link_url, link_text, link_type } = req.body || {};
    const robotReason = detectRobotRequest(req);
    if (robotReason) {
      return res.status(200).json({ ok: true, ignored: true, robot: true, reason: robotReason });
    }

    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);
    const cleanLinkUrl = trimText(link_url, 1200);
    if (!cleanLinkUrl) return res.status(200).json({ ok: true, ignored: true });

    const safeTypes = new Set(['internal', 'external', 'download', 'anchor', 'email', 'phone', 'link']);
    const payload = {
      visitor_id: cleanVisitorId || null,
      site_host: cleanHost,
      path: trimText(path, 600),
      link_url: cleanLinkUrl,
      link_text: trimText(link_text, 220),
      link_type: safeTypes.has(String(link_type || '')) ? String(link_type) : 'link',
      user_agent: trimText(req.headers['user-agent'], 500) || null,
      is_robot: false,
      robot_reason: null,
    };
    const legacyPayload = (() => {
      const p = { ...payload };
      delete p.user_agent;
      delete p.is_robot;
      delete p.robot_reason;
      return p;
    })();
    const payloads = [
      payload,
      legacyPayload,
      (() => { const p = { ...legacyPayload }; delete p.visitor_id; return p; })(),
      (() => { const p = { ...legacyPayload }; delete p.site_host; return p; })(),
      (() => { const p = { ...legacyPayload }; delete p.visitor_id; delete p.site_host; return p; })(),
    ];
    let clickResponse;
    for (const candidate of payloads) {
      clickResponse = await fetch(`${SUPABASE_URL}/rest/v1/link_clicks`, {
        method: 'POST',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify(candidate),
      });
      if (clickResponse.ok) break;
    }
    // Keep navigation smooth even if the optional click table has not been pasted into Supabase yet.
    return res.status(200).json({ ok: !!(clickResponse && clickResponse.ok) });
  }

  // ── Public POST: log donation interest ──────────────────────────
  if (req.method === 'POST' && type === 'interest') {
    const { visitor_id, site_host, name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign } = req.body || {};
    if (!country) return res.status(400).json({ error: 'country is required' });
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);
    const payload = { visitor_id: cleanVisitorId || null, site_host: cleanHost, name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign };
    const legacyPayload = (() => { const p = { ...payload }; delete p.visitor_id; delete p.site_host; return p; })();
    const r = await fetchWithFallback([
      { url: `${SUPABASE_URL}/rest/v1/donation_interests`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(payload) } },
      { url: `${SUPABASE_URL}/rest/v1/donation_interests`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(legacyPayload) } },
    ]);
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── Public POST: kit availability / interest request ─────────────
  if (req.method === 'POST' && type === 'availability') {
    const { visitor_id, site_host, country, region, name, email, organization, message, requested_items, utm_source, utm_medium, utm_campaign } = req.body || {};
    if (!country) return res.status(400).json({ error: 'country is required' });
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);
    const cleanItems = Array.isArray(requested_items) ? requested_items.slice(0, 12).map((item) => ({
      name: String((item && item.name) || '').slice(0, 120),
      min_price: Number.isFinite(Number(item && item.min_price)) ? Number(item.min_price) : null,
      max_price: Number.isFinite(Number(item && item.max_price)) ? Number(item.max_price) : null,
      quote_required: Boolean(item && item.quote_required),
    })).filter((item) => item.name) : [];
    const payload = { visitor_id: cleanVisitorId || null, site_host: cleanHost, country, region, name, email, organization, message, requested_items: cleanItems, utm_source, utm_medium, utm_campaign };
    const legacyPayload = (() => { const p = { ...payload }; delete p.visitor_id; delete p.site_host; return p; })();
    const r = await fetchWithFallback([
      { url: `${SUPABASE_URL}/rest/v1/availability_requests`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(payload) } },
      { url: `${SUPABASE_URL}/rest/v1/availability_requests`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(legacyPayload) } },
    ]);
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── Public POST: equipment & funding application ─────────────────
  if (req.method === 'POST' && type === 'application') {
    const b = req.body || {};
    const cleanName = trimText(b.name, 160);
    const cleanEmail = trimText(b.email, 255);
    const cleanCountry = trimText(b.country, 120);
    if (!cleanName || !cleanEmail || !cleanCountry) return res.status(400).json({ error: 'name, email, and country are required' });

    // Honeypot + crawler screening: pretend success so bots learn nothing.
    if (trimText(b.website, 500) || detectRobotRequest(req)) return res.status(200).json({ ok: true });

    // Only accept submissions while the applications_open flag is on. Fail
    // safe to "closed" if the flag cannot be confirmed.
    let open = false;
    try {
      const sr = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?select=value&key=eq.applications_open`, { headers: sbH, cache: 'no-store' });
      const rows = await jsonOrEmpty(sr);
      open = !!(rows.length && (rows[0].value === true || rows[0].value === 'true'));
    } catch (e) { open = false; }
    if (!open) return res.status(200).json({ ok: false, closed: true });

    // Rate limit: at most 3 submissions per email address per hour.
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const rl = await fetch(`${SUPABASE_URL}/rest/v1/equipment_applications?select=id&email=eq.${encodeURIComponent(cleanEmail)}&created_at=gte.${encodeURIComponent(since)}`, {
        headers: { ...sbH, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store',
      });
      const recent = exactCountFrom(rl);
      if (Number.isFinite(recent) && recent >= 3) {
        return res.status(429).json({ error: 'Too many submissions from this email — please wait an hour or email us directly.' });
      }
    } catch (e) { /* if the check fails, accept the submission */ }

    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(b.site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const cleanVisitorId = String(b.visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120);
    const cleanEquipment = Array.isArray(b.equipment_needed)
      ? b.equipment_needed.slice(0, 20).map((item) => String(item || '').slice(0, 120)).filter(Boolean)
      : [];

    const oneOf = (value, allowed) => (allowed.includes(String(value || '')) ? String(value) : null);
    const kitTier = Number.isInteger(Number(b.kit_tier)) && Number(b.kit_tier) >= 1 && Number(b.kit_tier) <= 5 ? Number(b.kit_tier) : null;
    const supportingDoc = cleanDataUrl(b.supporting_document, 3000000);
    const idDoc = cleanDataUrl(b.id_document);
    const licenseDoc = cleanDataUrl(b.license_document);
    const ministryPhotos = cleanPhotoArray(b.ministry_photos);

    const payload = {
      visitor_id: cleanVisitorId || null,
      site_host: cleanHost,
      name: cleanName,
      email: cleanEmail,
      phone_country_code: trimText(b.phone_country_code, 12) || null,
      phone: trimText(b.phone, 60) || null,
      organization: trimText(b.organization, 200) || null,
      role: trimText(b.role, 120) || null,
      country: cleanCountry,
      region: trimText(b.region, 160) || null,
      mission_context: trimText(b.mission_context, 2000) || null,
      equipment_needed: cleanEquipment,
      funding_needed: trimText(b.funding_needed, 200) || null,
      timeframe: trimText(b.timeframe, 160) || null,
      message: trimText(b.message, 2000) || null,
      utm_source: trimText(b.utm_source) || null,
      utm_medium: trimText(b.utm_medium) || null,
      utm_campaign: trimText(b.utm_campaign) || null,
      // Structured intake fields (see supabase/schema.sql)
      kit_tier: kitTier,
      reach_justification: trimText(b.reach_justification, 2000) || null,
      audience_type: oneOf(b.audience_type, ['individual', 'small_group', 'village_congregation', 'regional_network']),
      frequency_of_use: oneOf(b.frequency_of_use, ['one_time', 'weekly', 'daily']),
      has_gathering_infrastructure: typeof b.has_gathering_infrastructure === 'boolean' ? b.has_gathering_infrastructure : null,
      gathering_infrastructure_desc: trimText(b.gathering_infrastructure_desc, 1000) || null,
      languages: trimText(b.languages, 400) || null,
      literacy_context: trimText(b.literacy_context, 1000) || null,
      power_internet_access: oneOf(b.power_internet_access, ['none', 'limited', 'reliable']),
      org_website: trimText(b.org_website, 400) || null,
      sending_org: trimText(b.sending_org, 300) || null,
      reference_name: trimText(b.reference_name, 160) || null,
      reference_contact: trimText(b.reference_contact, 255) || null,
      referral_source: oneOf(b.referral_source, ['existing_partner', 'church_network', 'conference', 'search', 'social_media', 'other']),
      years_in_field: trimText(b.years_in_field, 60) || null,
      current_reach: trimText(b.current_reach, 200) || null,
      supporting_document: supportingDoc,
      supporting_document_name: supportingDoc ? (trimText(b.supporting_document_name, 200) || 'document') : null,
      // ── Proof of ministry ──
      ministry_verification_mode: oneOf(b.ministry_verification_mode, ['documents', 'safety_exempt']) || 'documents',
      ministry_license_body: trimText(b.ministry_license_body, 200) || null,
      ministry_license_ref: trimText(b.ministry_license_ref, 120) || null,
      id_document: idDoc,
      id_document_name: idDoc ? (trimText(b.id_document_name, 200) || 'photo-id') : null,
      license_document: licenseDoc,
      license_document_name: licenseDoc ? (trimText(b.license_document_name, 200) || 'licensing') : null,
      ministry_photos: ministryPhotos,
      reference_relationship: trimText(b.reference_relationship, 200) || null,
      reference2_name: trimText(b.reference2_name, 160) || null,
      reference2_contact: trimText(b.reference2_contact, 255) || null,
      reference2_relationship: trimText(b.reference2_relationship, 200) || null,
      interview_consent: typeof b.interview_consent === 'boolean' ? b.interview_consent : null,
      interview_availability: trimText(b.interview_availability, 600) || null,
      safety_exempt_reason: trimText(b.safety_exempt_reason, 1000) || null,
      funnel: oneOf(b.funnel, ['general', 'kenya_schools']) || 'general',
      receiving_plan: oneOf(b.receiving_plan, ['cover_import_costs', 'transport_partner', 'approved_retailer', 'alternative_plan', 'need_help']),
      receiving_plan_details: trimText(b.receiving_plan_details, 1000) || null,
      shipping_address: trimText(b.shipping_address, 1000) || null,
      preferred_contact_method: trimText(b.preferred_contact_method, 120) || null,
      contact_timezone: trimText(b.contact_timezone, 120) || null,
      status: 'submitted',
    };

    // Verification first — triage reads its score, because an unverified file
    // must never fast-track no matter how clean the rest of it looks.
    const verification = computeVerification(payload);
    const { verification_gaps: verificationGaps, ...verificationColumns } = verification;
    Object.assign(payload, verificationColumns);
    const triage = computeTriage(payload);
    Object.assign(payload, triage);

    // Legacy fallback keeps intake alive if the schema migration has not
    // been pasted into Supabase yet — original columns only.
    const payloadWithoutShipping = { ...payload };
    delete payloadWithoutShipping.shipping_address;
    // A database that has the structured intake columns but not yet the
    // ministry-verification migration would otherwise skip all the way down to
    // legacyPayload and lose every structured answer. This tier keeps them.
    const payloadWithoutVerification = { ...payload };
    for (const col of ['ministry_verification_mode', 'ministry_license_body', 'ministry_license_ref',
      'id_document', 'id_document_name', 'license_document', 'license_document_name', 'ministry_photos',
      'reference_relationship', 'reference2_name', 'reference2_contact', 'reference2_relationship',
      'interview_consent', 'interview_availability', 'interview_status', 'safety_exempt_reason',
      'verification_status', 'verification_score', 'verification_note', 'funnel']) {
      delete payloadWithoutVerification[col];
    }
    const legacyPayload = {
      visitor_id: payload.visitor_id, site_host: payload.site_host, name: payload.name,
      email: payload.email, phone_country_code: payload.phone_country_code, phone: payload.phone,
      organization: payload.organization, role: payload.role, country: payload.country,
      region: payload.region, mission_context: payload.mission_context,
      equipment_needed: payload.equipment_needed, funding_needed: payload.funding_needed,
      timeframe: payload.timeframe, message: payload.message,
      utm_source: payload.utm_source, utm_medium: payload.utm_medium, utm_campaign: payload.utm_campaign,
    };
    const r = await fetchWithFallback([
      { url: `${SUPABASE_URL}/rest/v1/equipment_applications`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(payload) } },
      { url: `${SUPABASE_URL}/rest/v1/equipment_applications`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(payloadWithoutShipping) } },
      { url: `${SUPABASE_URL}/rest/v1/equipment_applications`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(payloadWithoutVerification) } },
      { url: `${SUPABASE_URL}/rest/v1/equipment_applications`, options: { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(legacyPayload) } },
    ]);
    if (r.ok) {
      const savedRows = await r.json().catch(() => []);
      const savedApp = Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : payload;
      await sendApplicationEmails({ app: payload, triage });
      if (savedApp && savedApp.id) {
        try {
          await ensureThreadForApplication(savedApp.id, savedApp);
          if (process.env.LAURA_DRAFT_ON_SUBMIT !== 'false') {
            // Whether the acknowledgment actually sends is decided by the
            // autonomy level and cooldown inside the agent, not here.
            await runLauraAgent({
              applicationId: savedApp.id,
              reason: 'application_submit',
            });
          }
        } catch (e) {
          // Intake should never fail just because the optional agent tables or
          // external AI/email services are not configured yet.
        }
      }
    }
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  }

  // ── Admin endpoints — everything below requires a valid signed token ──
  if (!isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  // Admin: list equipment & funding applications
  if (req.method === 'GET' && type === 'applications') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/equipment_applications?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  // Admin: delete an equipment & funding application
  if (req.method === 'DELETE' && type === 'applications') {
    const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/equipment_applications?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: sbH,
    });
    return res.status(r.ok ? 204 : r.status).end();
  }

  // Admin: update an application's review status / notes
  if (req.method === 'PATCH' && type === 'applications') {
    const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const b = req.body || {};
    const patch = {};
    const STATUSES = ['submitted', 'under_review', 'approved', 'declined', 'waitlisted', 'new'];
    if (b.status !== undefined) {
      if (!STATUSES.includes(String(b.status))) return res.status(400).json({ error: 'invalid status' });
      patch.status = String(b.status);
      patch.status_updated_at = new Date().toISOString();
    }
    if (b.admin_notes !== undefined) patch.admin_notes = trimText(b.admin_notes, 4000) || null;

    // Marking the interview done is the one gate Laura cannot open for herself,
    // so it has to be settable by a human here. Setting it to 'completed'
    // stamps the time, because "when did we speak to them" is the question
    // asked later and a boolean cannot answer it.
    const INTERVIEW_STATUSES = ['not_needed', 'required', 'invited', 'scheduled', 'completed', 'declined'];
    if (b.interview_status !== undefined) {
      if (!INTERVIEW_STATUSES.includes(String(b.interview_status))) return res.status(400).json({ error: 'invalid interview_status' });
      patch.interview_status = String(b.interview_status);
      patch.interview_completed_at = patch.interview_status === 'completed' ? new Date().toISOString() : null;
    }
    const VERIFICATION_STATUSES = ['unverified', 'pending_review', 'interview_required', 'verified', 'rejected'];
    if (b.verification_status !== undefined) {
      if (!VERIFICATION_STATUSES.includes(String(b.verification_status))) return res.status(400).json({ error: 'invalid verification_status' });
      patch.verification_status = String(b.verification_status);
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/equipment_applications?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  // ── Admin: deployment log (mirrors Eric's Excel structure) ────────
  const DEPLOYMENT_TEXT_FIELDS = [
    'name', 'contact_information', 'country', 'region_village',
    'raspberry_pi_5', 'power_supply', 'satellite_dish', 'lnb', 'receiver',
    'satellite_finder', 'coax_cable', 'usb_a_to_c', 'usb_a_to_micro_b',
    'projector', 'speakers', 'language_card', 'usb_adapter', 'newq_device',
    'charger_100w_20_port', 'bibles', 'monetary_support', 'online_support',
    'power_charger_for_raspberry', 'highlights', 'follow_up_needed', 'additional_notes',
  ];
  function cleanDeployment(body, { partial = false } = {}) {
    const b = body || {};
    const row = {};
    for (const f of DEPLOYMENT_TEXT_FIELDS) {
      if (partial && b[f] === undefined) continue;
      row[f] = trimText(b[f], f === 'highlights' || f === 'follow_up_needed' || f === 'additional_notes' ? 4000 : 400) || null;
    }
    if (!partial || b.date !== undefined) {
      row.date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : null;
    }
    if (!partial || b.application_id !== undefined) {
      const appId = String(b.application_id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
      row.application_id = appId || null;
    }
    if (!partial || b.in_person_support !== undefined) {
      row.in_person_support = Array.isArray(b.in_person_support)
        ? b.in_person_support.slice(0, 40).map((w) => ({
          label: trimText(w && w.label, 200),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String((w && w.date) || '')) ? String(w.date) : null,
        })).filter((w) => w.label || w.date)
        : [];
    }
    return row;
  }

  if (req.method === 'GET' && (type === 'deployment' || type === 'deployments')) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deployments?select=*&order=date.desc.nullslast,created_at.desc`, { headers: sbH, cache: 'no-store' });
    return res.status(r.ok ? 200 : r.status).json(r.ok ? await r.json() : []);
  }

  if (req.method === 'POST' && (type === 'deployment' || type === 'deployments')) {
    const row = cleanDeployment(req.body);
    if (!row.name) return res.status(400).json({ error: 'name is required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deployments`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  if (req.method === 'PATCH' && (type === 'deployment' || type === 'deployments')) {
    const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const row = cleanDeployment(req.body, { partial: true });
    if (!Object.keys(row).length) return res.status(400).json({ error: 'nothing to update' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deployments?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  if (req.method === 'DELETE' && (type === 'deployment' || type === 'deployments')) {
    const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deployments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: sbH });
    return res.status(r.ok ? 204 : r.status).end();
  }

  // Admin: set a site setting flag (e.g. flip applications_open on/off)
  if (req.method === 'POST' && type === 'setting') {
    const key = String((req.body && req.body.key) || '').replace(/[^a-z0-9_]/gi, '').slice(0, 60);
    if (!key) return res.status(400).json({ error: 'key is required' });
    const value = req.body ? req.body.value : null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ key, value }),
    });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && (type === 'availability' || type === 'availabilities')) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/availability_requests?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'visits') {
    const r = await fetchWithFallback([
      { url: `${SUPABASE_URL}/rest/v1/page_visits?select=*&is_robot=not.is.true&order=created_at.desc&limit=200`, options: { headers: sbH, cache: 'no-store' } },
      { url: `${SUPABASE_URL}/rest/v1/page_visits?select=*&order=created_at.desc&limit=200`, options: { headers: sbH, cache: 'no-store' } },
    ]);
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'clicks') {
    const r = await fetchWithFallback([
      { url: `${SUPABASE_URL}/rest/v1/link_clicks?select=*&is_robot=not.is.true&order=created_at.desc&limit=500`, options: { headers: sbH, cache: 'no-store' } },
      { url: `${SUPABASE_URL}/rest/v1/link_clicks?select=*&order=created_at.desc&limit=500`, options: { headers: sbH, cache: 'no-store' } },
    ]);
    return res.status(r.ok ? r.status : 200).json(r.ok ? await r.json() : []);
  }

  if (req.method === 'GET' && type === 'interests') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/donation_interests?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'contacts') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'summary') {
    const visitRangeHeaders = { ...sbH, Prefer: 'count=exact', Range: '0-499' };
    const clickRangeHeaders = { ...sbH, Prefer: 'count=exact', Range: '0-499' };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = encodeURIComponent(todayStart.toISOString());
    let [visitsR, uniqueR, todayR, clicksR, interestsR, availR, contactsR] = await Promise.all([
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id,site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,country,region,city,created_at,is_robot,robot_reason&is_robot=not.is.true&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id,site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,country,region,city,created_at&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id,site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at,is_robot,robot_reason&is_robot=not.is.true&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id,site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at&order=created_at.desc&limit=500`, options: { headers: visitRangeHeaders, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id&visitor_id=not.is.null&is_robot=not.is.true&order=created_at.desc&limit=10000`, options: { headers: sbH, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=visitor_id&visitor_id=not.is.null&order=created_at.desc&limit=10000`, options: { headers: sbH, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=id&created_at=gte.${todayIso}&is_robot=not.is.true`, options: { headers: { ...sbH, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/page_visits?select=id&created_at=gte.${todayIso}`, options: { headers: { ...sbH, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/link_clicks?select=visitor_id,site_host,path,link_url,link_text,link_type,created_at,is_robot,robot_reason&is_robot=not.is.true&order=created_at.desc&limit=500`, options: { headers: clickRangeHeaders, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/link_clicks?select=visitor_id,site_host,path,link_url,link_text,link_type,created_at&order=created_at.desc&limit=500`, options: { headers: clickRangeHeaders, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/donation_interests?select=visitor_id,site_host,country,initiative,utm_source,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/donation_interests?select=country,initiative,utm_source,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/availability_requests?select=visitor_id,site_host,country,region,requested_items,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/availability_requests?select=country,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
      ]),
      fetchWithFallback([
        { url: `${SUPABASE_URL}/rest/v1/contact_messages?select=visitor_id,site_host,name,email,message,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
        { url: `${SUPABASE_URL}/rest/v1/contact_messages?select=name,email,message,created_at&order=created_at.desc`, options: { headers: sbH, cache: 'no-store' } },
      ]),
    ]);
    const totalPageVisits = exactCountFrom(visitsR);
    const visitsToday = exactCountFrom(todayR);
    const totalLinkClicks = clicksR && (clicksR.ok || clicksR.status === 206) ? exactCountFrom(clicksR) : 0;
    const [visits, uniqueRows, clicks, interests, availabilities, contacts] = await Promise.all([
      jsonOrEmpty(visitsR),
      jsonOrEmpty(uniqueR),
      clicksR && (clicksR.ok || clicksR.status === 206) ? jsonOrEmpty(clicksR) : Promise.resolve([]),
      jsonOrEmpty(interestsR),
      availR.ok ? jsonOrEmpty(availR) : Promise.resolve([]),
      contactsR && (contactsR.ok || contactsR.status === 206) ? jsonOrEmpty(contactsR) : Promise.resolve([]),
    ]);
    const uniqueIds = new Set(uniqueRows.map((v) => v.visitor_id).filter(Boolean));
    if (!uniqueIds.size) visits.forEach((v) => { if (v.visitor_id) uniqueIds.add(v.visitor_id); });
    clicks.forEach((c) => { if (c.visitor_id) uniqueIds.add(c.visitor_id); });
    interests.forEach((i) => { if (i.visitor_id) uniqueIds.add(i.visitor_id); });
    availabilities.forEach((a) => { if (a.visitor_id) uniqueIds.add(a.visitor_id); });
    contacts.forEach((c) => { if (c.visitor_id) uniqueIds.add(c.visitor_id); });
    return res.status(200).json({
      visits: visits || [],
      clicks: clicks || [],
      interests: interests || [],
      availabilities: availabilities || [],
      contacts: contacts || [],
      totals: {
        total_page_visits: totalPageVisits == null ? visits.length : totalPageVisits,
        individual_people: uniqueIds.size,
        visits_today: visitsToday == null ? visits.filter((v) => new Date(v.created_at).toDateString() === new Date().toDateString()).length : visitsToday,
        total_link_clicks: totalLinkClicks == null ? clicks.length : totalLinkClicks,
        loaded_visits: visits.length,
        loaded_clicks: clicks.length,
        robot_filtered: true,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
