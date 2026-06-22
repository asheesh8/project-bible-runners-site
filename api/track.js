// /api/track.js — Visit tracking + donation interest capture
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD
//
// Public (no auth):
//   POST /api/track?type=visit     { site_host, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid }
//   POST /api/track?type=interest  { name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign }
//
// Admin (Authorization: Bearer <ADMIN_PASSWORD>):
//   GET  /api/track?type=visits
//   GET  /api/track?type=interests
//   GET  /api/track?type=summary

export default async function handler(req, res) {
  const { ADMIN_PASSWORD } = process.env;
  // Accept either our own names or the ones the Supabase–Vercel integration creates.
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;
  const VALID = ['visit', 'visits', 'interest', 'interests', 'availability', 'availabilities', 'summary', 'health'];
  if (!VALID.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  // ── Admin health check: report pipeline status without exposing secrets ──
  if (type === 'health') {
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
    if (!ADMIN_PASSWORD || authHeader !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
    const out = { supabase_configured: configured, admin_password_set: !!ADMIN_PASSWORD, tables: {}, visit_count: null, latest_visit_at: null };
    if (!configured) return res.status(200).json(out);
    const probeH = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
    for (const t of ['page_visits', 'donation_interests', 'availability_requests']) {
      try {
        const rr = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=id`, { headers: { ...probeH, Prefer: 'count=exact', Range: '0-0' } });
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
        const lv = await fetch(`${SUPABASE_URL}/rest/v1/page_visits?select=created_at&order=created_at.desc&limit=1`, { headers: probeH });
        const arr = await lv.json();
        out.latest_visit_at = Array.isArray(arr) && arr[0] ? arr[0].created_at : null;
      } catch (e) { /* ignore */ }
    }
    return res.status(200).json(out);
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
    const { site_host, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid } = req.body || {};
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const cleanHost = String(site_host || forwardedHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').slice(0, 255);
    const payload = { site_host: cleanHost, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid };
    let visitResponse = await fetch(`${SUPABASE_URL}/rest/v1/page_visits`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    // Keep tracking alive during the short window before the site_host migration is applied.
    if (!visitResponse.ok) {
      const legacyPayload = { ...payload };
      delete legacyPayload.site_host;
      visitResponse = await fetch(`${SUPABASE_URL}/rest/v1/page_visits`, {
        method: 'POST',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify(legacyPayload),
      });
    }
    return res.status(visitResponse.ok ? 200 : 502).json({ ok: visitResponse.ok });
  }

  // ── Public POST: log donation interest ──────────────────────────
  if (req.method === 'POST' && type === 'interest') {
    const { name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign } = req.body || {};
    if (!country) return res.status(400).json({ error: 'country is required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/donation_interests`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify({ name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign }),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── Public POST: kit availability / interest request ─────────────
  if (req.method === 'POST' && type === 'availability') {
    const { country, region, name, email, organization, message, requested_items, utm_source, utm_medium, utm_campaign } = req.body || {};
    if (!country) return res.status(400).json({ error: 'country is required' });
    const cleanItems = Array.isArray(requested_items) ? requested_items.slice(0, 12).map((item) => ({
      name: String((item && item.name) || '').slice(0, 120),
      min_price: Number.isFinite(Number(item && item.min_price)) ? Number(item.min_price) : null,
      max_price: Number.isFinite(Number(item && item.max_price)) ? Number(item.max_price) : null,
      quote_required: Boolean(item && item.quote_required),
    })).filter((item) => item.name) : [];
    const r = await fetch(`${SUPABASE_URL}/rest/v1/availability_requests`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify({ country, region, name, email, organization, message, requested_items: cleanItems, utm_source, utm_medium, utm_campaign }),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ── Admin reads ──────────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
  if (authHeader !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET' && (type === 'availability' || type === 'availabilities')) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/availability_requests?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'visits') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/page_visits?select=*&order=created_at.desc&limit=200`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'interests') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/donation_interests?select=*&order=created_at.desc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'GET' && type === 'summary') {
    let [visitsR, interestsR] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/page_visits?select=site_host,path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at&order=created_at.desc&limit=500`, { headers: sbH, cache: 'no-store' }),
      fetch(`${SUPABASE_URL}/rest/v1/donation_interests?select=country,initiative,utm_source,created_at&order=created_at.desc`, { headers: sbH }),
    ]);
    if (!visitsR.ok) visitsR = await fetch(`${SUPABASE_URL}/rest/v1/page_visits?select=path,referrer,utm_source,utm_medium,utm_campaign,fbclid,ttclid,created_at&order=created_at.desc&limit=500`, { headers: sbH, cache: 'no-store' });
    const [visits, interests] = await Promise.all([visitsR.json(), interestsR.json()]);
    return res.status(200).json({ visits: visits || [], interests: interests || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
