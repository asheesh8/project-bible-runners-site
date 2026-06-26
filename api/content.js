// Vercel serverless function — Supabase content CRUD
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD
//
// Public endpoints (no auth):
//   GET /api/content?type=campaigns
//   GET /api/content?type=campaigns&slug=spring-uganda-2026
//   GET /api/content?type=posts
//   GET /api/content?type=photos
//
// Admin endpoints (Authorization: Bearer <ADMIN_PASSWORD>):
//   POST   /api/content?type=campaigns   body={}
//   PATCH  /api/content?type=campaigns&id=uuid  body={}
//   DELETE /api/content?type=campaigns&id=uuid

const TABLES = { campaigns: true, posts: true, photos: true, testimonies: true };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD } = process.env;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // Return empty data gracefully so pages degrade to static fallback
    if (req.method === 'GET') return res.status(200).json([]);
    return res.status(503).json({ error: 'Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars.' });
  }

  const { type, slug, id } = req.query;
  if (!TABLES[type]) return res.status(400).json({ error: 'Invalid type. Use: campaigns | posts | photos | testimonies' });

  const sbHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── GET (public read) ────────────────────────────────────────────
  if (req.method === 'GET') {
    let url = `${SUPABASE_URL}/rest/v1/${type}?select=*&order=created_at.desc`;
    if (slug) url += `&slug=eq.${encodeURIComponent(slug)}`;
    if (id)   url += `&id=eq.${encodeURIComponent(id)}`;
    // Only return published posts to public
    if (type === 'posts' && !req.headers.authorization) url += '&published=eq.true';

    const r = await fetch(url, { headers: sbHeaders });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── Writes require admin auth ────────────────────────────────────
  const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
  if (authHeader !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${type}`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${type}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id query param required' });
    await fetch(`${SUPABASE_URL}/rest/v1/${type}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: sbHeaders,
    });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
