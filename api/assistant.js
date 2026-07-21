// /api/assistant.js — public site assistant (chatbot + light intake)
//
// Answers visitor questions grounded ONLY in the site knowledge base
// (api/_lib/knowledge-base.js), and captures interested missionaries as leads.
//
// Env vars:
//   VillageServerChatBotAnthropicKey (or ANTHROPIC_API_KEY) — required; the assistant's brain (Claude Haiku)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — store captured leads
//   RESEND_API_KEY, CONTACT_FROM_EMAIL, NOTIFY_EMAIL — optional lead notification
//
// Public:
//   POST /api/assistant  { messages:[{role,content}], visitor_id, site_host, website }
//     → { reply: "…", lead_captured: bool }
import crypto from 'node:crypto';
import { CORE_KNOWLEDGE, retrieveKnowledge } from './_lib/knowledge-retriever.js';
import { PERSONA } from './_lib/assistant-persona.js';

const MODEL = 'claude-haiku-4-5';
const ROBOT_RE = /bot|crawler|spider|crawl|slurp|facebookexternalhit|headlesschrome|phantomjs|lighthouse|semrush|ahrefs|bytespider|python-requests|httpclient|curl|wget/i;

// ── Guardrails (safe to tune) ───────────────────────────────────────
const MAX_MSG_CHARS = 500;        // hard cap on a single user message
const MAX_HISTORY = 8;            // messages of context sent to the model
const MAX_REPLY_CHARS = 800;      // room for a useful answer without a wall of text
const MAX_OUTPUT_TOKENS = 300;    // bounds model spend before the character cap
const WINDOW_HOURS = 6;           // rolling window for the per-user limits
const PER_VISITOR_LIMIT = 10;     // messages per window, per browser/device
const PER_IP_LIMIT = 30;          // shared-network abuse backstop
const GLOBAL_DAILY_LIMIT = 1000;  // absolute messages across everyone / 24h

// Serverless-instance fallback used only until/when the durable Supabase RPC is
// unavailable. It is intentionally conservative and still prevents tight loops
// on a warm instance; the database limiter remains the cross-instance authority.
const memoryUsage = globalThis.__vsiAssistantUsage || (globalThis.__vsiAssistantUsage = []);

const TOOLS = [{
  name: 'capture_lead',
  description: "Record an interested missionary or field partner so the team can follow up. Only call once you have at least their name and email and they've expressed interest in receiving equipment or partnering.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Their name' },
      email: { type: 'string', description: 'Their email address' },
      country: { type: 'string', description: 'Country of their mission, if known' },
      interest: { type: 'string', description: 'What equipment or help they are interested in' },
      summary: { type: 'string', description: 'One or two sentences summarizing their situation for the team' },
    },
    required: ['name', 'email'],
  },
}];

function trim(v, max = 2000) { return String(v || '').trim().slice(0, max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }

// Clean a user message: strip emojis and control characters (so the model
// can't be nudged off-course by junk), collapse whitespace, and hard-cap length.
function cleanUserText(v) {
  return String(v || '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[\u200D\uFE0F\u20E3\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MSG_CHARS);
}

function cleanReplyText(v) {
  const text = String(v || '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[\u200D\uFE0F\u20E3\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_REPLY_CHARS) return text;

  const clipped = text.slice(0, MAX_REPLY_CHARS + 1);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('! '),
    clipped.lastIndexOf('? '),
  );
  if (sentenceEnd >= Math.floor(MAX_REPLY_CHARS * 0.55)) return clipped.slice(0, sentenceEnd + 1);

  const wordEnd = clipped.slice(0, MAX_REPLY_CHARS - 1).lastIndexOf(' ');
  return `${clipped.slice(0, wordEnd > 0 ? wordEnd : MAX_REPLY_CHARS - 1).trimEnd()}.`;
}

export { cleanUserText, cleanReplyText };

// A stable, privacy-preserving key for the visitor's IP (hashed, never stored raw).
function ipKeyFrom(req) {
  const raw = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim();
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function consumeMemoryQuota(meta) {
  const now = Date.now();
  const windowStart = now - WINDOW_HOURS * 3600 * 1000;
  const dayStart = now - 24 * 3600 * 1000;
  while (memoryUsage.length && memoryUsage[0].at < dayStart) memoryUsage.shift();
  const visitorCount = meta.visitor_key
    ? memoryUsage.filter((row) => row.at >= windowStart && row.visitor_key === meta.visitor_key).length : 0;
  const ipCount = meta.ip_key
    ? memoryUsage.filter((row) => row.at >= windowStart && row.ip_key === meta.ip_key).length : 0;
  if (memoryUsage.length >= GLOBAL_DAILY_LIMIT || visitorCount >= PER_VISITOR_LIMIT || ipCount >= PER_IP_LIMIT) return false;
  memoryUsage.push({ at: now, visitor_key: meta.visitor_key, ip_key: meta.ip_key });
  return true;
}

// The database function checks and records all three limits atomically. A
// conservative instance-local fallback keeps chat usable during migration or a
// brief database outage without leaving a warm function open to request loops.
async function checkAndRecordUsage(meta) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) return { allowed: consumeMemoryQuota(meta), fallback: true };
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_assistant_quota`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_visitor_key: meta.visitor_key || null,
        p_ip_key: meta.ip_key || null,
        p_window_hours: WINDOW_HOURS,
        p_visitor_limit: PER_VISITOR_LIMIT,
        p_ip_limit: PER_IP_LIMIT,
        p_global_limit: GLOBAL_DAILY_LIMIT,
      }),
    });
    if (!r.ok) return { allowed: consumeMemoryQuota(meta), fallback: true };
    return { allowed: (await r.json()) === true };
  } catch (e) {
    return { allowed: consumeMemoryQuota(meta), fallback: true };
  }
}

async function anthropic(apiKey, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function storeLead(input, meta) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) return false;
  const payload = {
    visitor_id: meta.visitor_id || null,
    site_host: meta.site_host || null,
    name: trim(input.name, 160) || null,
    email: trim(input.email, 255) || null,
    country: trim(input.country, 120) || null,
    interest: trim(input.interest, 400) || null,
    summary: trim(input.summary, 1000) || null,
  };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/assistant_leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    if (r.ok) await notifyTeam(payload);
    return r.ok;
  } catch (e) { return false; }
}

async function notifyTeam(lead) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || 'VillageServer Initiative <onboarding@resend.dev>',
        to: [process.env.NOTIFY_EMAIL || 'villageserverinitiative@gmail.com'],
        reply_to: lead.email || undefined,
        subject: `New assistant lead — ${lead.name || 'someone'}${lead.country ? ` (${lead.country})` : ''}`,
        text: `Captured by the site assistant:\n\nName: ${lead.name || '—'}\nEmail: ${lead.email || '—'}\nCountry: ${lead.country || '—'}\nInterest: ${lead.interest || '—'}\n\n${lead.summary || ''}`,
      }),
    });
  } catch (e) { /* best effort */ }
}

async function storeTranscript({ sessionId, email, messages, meta }) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY || !sessionId || !validEmail(email)) return false;
  const safeMessages = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.role === 'assistant' ? cleanReplyText(m.content) : cleanUserText(m.content),
  })).filter((m) => m.content);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/assistant_transcripts?on_conflict=session_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        session_id: sessionId,
        visitor_id: meta.visitor_id || null,
        site_host: meta.site_host || null,
        email: String(email).trim().toLowerCase().slice(0, 255),
        messages: safeMessages,
        updated_at: new Date().toISOString(),
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.VillageServerChatBotAnthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Assistant is not configured yet.' });

  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
  const sessionId = String(b.session_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!validEmail(email)) return res.status(400).json({ error: 'A valid email address is required.' });
  if (!sessionId) return res.status(400).json({ error: 'A chat session is required.' });

  // Honeypot + crawler screen: pretend-succeed so bots learn nothing and cost nothing.
  const ua = String(req.headers['user-agent'] || '');
  if (trim(b.website, 200) || ROBOT_RE.test(ua)) return res.status(200).json({ reply: '', ignored: true });

  const incoming = Array.isArray(b.messages) ? b.messages : [];
  const transcriptMessages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-19)
    .map((m) => ({ role: m.role, content: m.role === 'user' ? cleanUserText(m.content) : cleanReplyText(m.content) }))
    .filter((m) => m.content);
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY) // cap history sent to the model
    .map((m) => ({ role: m.role, content: m.role === 'user' ? cleanUserText(m.content) : trim(m.content, 1500) }))
    .filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'A user message is required.' });
  }

  const meta = {
    visitor_id: String(b.visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120),
    site_host: String(b.site_host || '').toLowerCase().replace(/^www\./, '').slice(0, 255),
  };
  meta.visitor_key = meta.visitor_id || null;
  meta.ip_key = ipKeyFrom(req);

  // Rate limit BEFORE spending anything on the model. A blocked request never
  // reaches Claude, so abuse costs essentially nothing.
  const usage = await checkAndRecordUsage(meta);
  if (!usage.allowed) {
    return res.status(200).json({
      reply: "You've reached the chat limit for now. Please try again later, or use the contact form for help.",
      limited: true,
    });
  }

  const retrievalQuery = messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ');
  const relevantKnowledge = retrieveKnowledge(retrievalQuery);
  const system = [
    { type: 'text', text: PERSONA },
    { type: 'text', text: `This is your stable core information about VillageServer. Answer only from the information provided, but never refer to it as a knowledge base, section, context, or source.\n\n${CORE_KNOWLEDGE}`, cache_control: { type: 'ephemeral' } },
  ];
  if (relevantKnowledge) system.push({
    type: 'text',
    text: `These are the site pages most relevant to the visitor's current question:\n\n${relevantKnowledge}`,
  });

  try {
    let leadCaptured = false;
    let response = await anthropic(apiKey, { model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system, tools: TOOLS, messages });

    // Handle at most one round of lead capture, then get the final reply.
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((c) => c.type === 'tool_use');
      const toolResults = [];
      for (const tu of toolUses) {
        if (tu.name === 'capture_lead') {
          leadCaptured = (await storeLead(tu.input || {}, meta)) || leadCaptured;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: leadCaptured ? 'Saved. The team will follow up.' : 'Noted.' });
      }
      response = await anthropic(apiKey, {
        model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system, tools: TOOLS,
        messages: [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }],
      });
    }

    const reply = cleanReplyText((response.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'))
      || "I'm sorry — I didn't catch that. Could you rephrase?";
    await storeTranscript({ sessionId, email, messages: [...transcriptMessages, { role: 'assistant', content: reply }], meta });
    return res.status(200).json({ reply, lead_captured: leadCaptured });
  } catch (e) {
    return res.status(200).json({ reply: "Sorry — I'm having trouble right now. Please try again, or use the contact form and the team will help you directly." });
  }
}
