import { isAuthorizedAdmin } from './_lib/admin-token.js';

function config() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  };
}

function transcriptText(row) {
  const lines = (Array.isArray(row.messages) ? row.messages : []).map((m) =>
    `${m && m.role === 'assistant' ? 'VillageServer Assistant' : 'You'}: ${String((m && m.content) || '').trim()}`,
  );
  return `Here is a copy of your VillageServer Assistant conversation.\n\n${lines.join('\n\n')}\n\nVillageServer Initiative\nhttps://villageserver.org`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { url, key } = config();
  if (!url || !key) return res.status(503).json({ error: 'Supabase is not configured.' });
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };

  if (req.method === 'GET') {
    const r = await fetch(`${url}/rest/v1/assistant_transcripts?select=*&order=updated_at.desc&limit=200`, { headers, cache: 'no-store' });
    return res.status(r.status).json(r.ok ? await r.json() : { error: 'Could not load chats. Apply the assistant_transcripts schema migration.' });
  }

  if (req.method === 'POST' && req.query.action === 'send') {
    const id = String(req.query.id || '').replace(/[^a-f0-9-]/gi, '').slice(0, 80);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const rowResponse = await fetch(`${url}/rest/v1/assistant_transcripts?id=eq.${encodeURIComponent(id)}&select=*`, { headers });
    const rows = rowResponse.ok ? await rowResponse.json() : [];
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Chat not found.' });
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(503).json({ error: 'Email sending is not configured.' });

    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || 'VillageServer Initiative <onboarding@resend.dev>',
        to: [row.email],
        reply_to: process.env.NOTIFY_EMAIL || 'villageserverinitiative@gmail.com',
        subject: 'Your VillageServer Assistant conversation',
        text: transcriptText(row),
      }),
    });
    if (!sent.ok) return res.status(502).json({ error: 'The email provider rejected the message.' });
    await fetch(`${url}/rest/v1/assistant_transcripts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ emailed_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
