// /api/track.js — Visit tracking + donation interest capture
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD
//
// Public (no auth):
//   POST /api/track?type=visit     { visitor_id, site_host, path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid }
//   POST /api/track?type=click     { visitor_id, site_host, path, link_url, link_text, link_type }
//   POST /api/track?type=interest  { visitor_id, site_host, name, email, country, initiative, practical_need, utm_source, utm_medium, utm_campaign }
//
// Admin (Authorization: Bearer <ADMIN_PASSWORD>):
//   GET  /api/track?type=visits
//   GET  /api/track?type=interests
//   GET  /api/track?type=summary

const ROBOT_USER_AGENT_RE = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|google-inspectiontool|googleother|adsbot|mediapartners-google|apis-google|feedfetcher|monitor|uptime|pingdom|headlesschrome|phantomjs|lighthouse|pagespeed|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|yandex|baiduspider|duckduckbot|archive\.org|wget|curl|python-requests|httpclient/i;

function trimText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
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
  const VALID = ['visit', 'visits', 'click', 'clicks', 'interest', 'interests', 'availability', 'availabilities', 'summary', 'health'];
  if (!VALID.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  // ── Admin health check: report pipeline status without exposing secrets ──
  if (type === 'health') {
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
    if (!ADMIN_PASSWORD || authHeader !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const configured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
    const out = { supabase_configured: configured, admin_password_set: !!ADMIN_PASSWORD, tables: {}, visit_count: null, latest_visit_at: null };
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

  // ── Admin reads ──────────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
  if (authHeader !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

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

  if (req.method === 'GET' && type === 'summary') {
    const visitRangeHeaders = { ...sbH, Prefer: 'count=exact', Range: '0-499' };
    const clickRangeHeaders = { ...sbH, Prefer: 'count=exact', Range: '0-499' };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = encodeURIComponent(todayStart.toISOString());
    let [visitsR, uniqueR, todayR, clicksR, interestsR, availR] = await Promise.all([
      fetchWithFallback([
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
    ]);
    const totalPageVisits = exactCountFrom(visitsR);
    const visitsToday = exactCountFrom(todayR);
    const totalLinkClicks = clicksR && (clicksR.ok || clicksR.status === 206) ? exactCountFrom(clicksR) : 0;
    const [visits, uniqueRows, clicks, interests, availabilities] = await Promise.all([
      jsonOrEmpty(visitsR),
      jsonOrEmpty(uniqueR),
      clicksR && (clicksR.ok || clicksR.status === 206) ? jsonOrEmpty(clicksR) : Promise.resolve([]),
      jsonOrEmpty(interestsR),
      availR.ok ? jsonOrEmpty(availR) : Promise.resolve([]),
    ]);
    const uniqueIds = new Set(uniqueRows.map((v) => v.visitor_id).filter(Boolean));
    if (!uniqueIds.size) visits.forEach((v) => { if (v.visitor_id) uniqueIds.add(v.visitor_id); });
    clicks.forEach((c) => { if (c.visitor_id) uniqueIds.add(c.visitor_id); });
    interests.forEach((i) => { if (i.visitor_id) uniqueIds.add(i.visitor_id); });
    availabilities.forEach((a) => { if (a.visitor_id) uniqueIds.add(a.visitor_id); });
    return res.status(200).json({
      visits: visits || [],
      clicks: clicks || [],
      interests: interests || [],
      availabilities: availabilities || [],
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
