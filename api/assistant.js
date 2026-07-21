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
import { KNOWLEDGE_BASE } from './_lib/knowledge-base.js';
import { PERSONA } from './_lib/assistant-persona.js';

const MODEL = 'claude-haiku-4-5';
const ROBOT_RE = /bot|crawler|spider|crawl|slurp|facebookexternalhit|headlesschrome|phantomjs|lighthouse|semrush|ahrefs|bytespider|python-requests|httpclient|curl|wget/i;

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

  // Honeypot + crawler screen: pretend-succeed so bots learn nothing and cost nothing.
  const ua = String(req.headers['user-agent'] || '');
  if (trim(b.website, 200) || ROBOT_RE.test(ua)) return res.status(200).json({ reply: '', ignored: true });

  const incoming = Array.isArray(b.messages) ? b.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12) // cap history
    .map((m) => ({ role: m.role, content: trim(m.content, 2000) }))
    .filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'A user message is required.' });
  }

  const meta = {
    visitor_id: String(b.visitor_id || '').replace(/[^\w:.-]/g, '').slice(0, 120),
    site_host: String(b.site_host || '').toLowerCase().replace(/^www\./, '').slice(0, 255),
  };

  const system = [
    { type: 'text', text: PERSONA },
    { type: 'text', text: `Below is everything you know about VillageServer, taken from the site itself. Answer only from what's here — but never refer to it as a "knowledge base", a "section", or a "source"; just answer naturally as yourself.\n\n${KNOWLEDGE_BASE}`, cache_control: { type: 'ephemeral' } },
  ];

  try {
    let leadCaptured = false;
    let response = await anthropic(apiKey, { model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages });

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
        model: MODEL, max_tokens: 1024, system, tools: TOOLS,
        messages: [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }],
      });
    }

    const reply = (response.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
      || "I'm sorry — I didn't catch that. Could you rephrase?";
    return res.status(200).json({ reply, lead_captured: leadCaptured });
  } catch (e) {
    return res.status(200).json({ reply: "Sorry — I'm having trouble right now. Please try again, or use the contact form and the team will help you directly." });
  }
}
