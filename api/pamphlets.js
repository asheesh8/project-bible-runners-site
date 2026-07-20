// /api/pamphlets.js — Dynamic pamphlet management
// Uses Supabase site_settings table (key = 'pamphlets_list') to store JSON list.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD
//
// Public:
//   GET  /api/pamphlets           → returns array of pamphlet objects
//
// Admin (Authorization: Bearer <signed token from /api/auth>):
//   POST /api/pamphlets           body: { action: 'save', pamphlets: [...] }
//     → replaces full pamphlet list

import { isAuthorizedAdmin } from './_lib/admin-token.js';

const SETTINGS_KEY = 'pamphlets_list';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getSupabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function readPamphlets(supabaseUrl, headers) {
  const url = `${supabaseUrl}/rest/v1/site_settings?select=value&key=eq.${SETTINGS_KEY}`;
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) return getDefaultPamphlets();
  const rows = await r.json();
  if (!rows || rows.length === 0) return getDefaultPamphlets();
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed : getDefaultPamphlets();
  } catch {
    return getDefaultPamphlets();
  }
}

async function savePamphlets(supabaseUrl, headers, pamphlets) {
  const value = JSON.stringify(pamphlets);
  const r = await fetch(`${supabaseUrl}/rest/v1/site_settings`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: SETTINGS_KEY, value }),
  });
  return r.ok || r.status === 201 || r.status === 200;
}

function getDefaultPamphlets() {
  return [
    { slug: 'mission-statement',        title: 'Mission Statement',                           url: './downloads/villageserver-mission-statement.pdf',                     category: 'About' },
    { slug: 'initiative-overview',      title: 'Full Initiative Overview',                    url: './downloads/villageserver-initiative-overview.pdf',                   category: 'About' },
    { slug: 'about-us',                 title: 'About Us',                                    url: './downloads/villageserver-about-us.pdf',                              category: 'About' },
    { slug: 'programs-and-services',    title: 'Programs and Services',                       url: './downloads/villageserver-programs-and-services.pdf',                 category: 'About' },
    { slug: 'photos-and-visuals',       title: 'Photos and Visuals',                          url: './downloads/villageserver-photos-and-visuals.pdf',                    category: 'About' },
    { slug: 'testimonials',             title: 'Testimonials',                                url: './downloads/villageserver-testimonials.pdf',                          category: 'About' },
    { slug: 'phone-distribution',       title: 'Phone-Based Gospel Distribution',             url: './downloads/villageserver-phone-based-gospel-distribution.pdf',       category: 'Field' },
    { slug: 'raspberry-pi-system',      title: 'Raspberry Pi VillageServer — System Overview',url: './downloads/villageserver-raspberry-pi-system.pdf',                   category: 'Technology' },
    { slug: 'raspberry-pi-quickstart',  title: 'Raspberry Pi — Field Quick Start Guide',      url: './downloads/villageserver-quick-start-guide.pdf',                     category: 'Technology' },
    { slug: 'power-and-solar',          title: 'Power Systems and Solar Solutions',           url: './downloads/villageserver-power-and-solar.pdf',                       category: 'Technology' },
    { slug: 'projector-and-audio',      title: 'Projector Systems and Audio Solutions',       url: './downloads/villageserver-projector-and-audio.pdf',                   category: 'Technology' },
    { slug: 'custom-libraries',         title: 'Content Libraries and Custom Ministry Resources', url: './downloads/villageserver-custom-libraries.pdf',                  category: 'Technology' },
    { slug: 'satellite-systems',        title: 'Satellite Systems and Content Acquisition',   url: './downloads/villageserver-satellite-systems.pdf',                     category: 'Technology' },
    { slug: 'ministry-partners',        title: 'Ministry Resource Partners',                  url: './downloads/villageserver-ministry-partners.pdf',                     category: 'Field' },
    { slug: 'get-and-share',            title: 'Get and Share Resources',                     url: './downloads/villageserver-get-and-share-resources.pdf',               category: 'Field' },
    { slug: 'transfer-devices',         title: 'Transfer Resources Between Devices',          url: './downloads/villageserver-transfer-resources-between-devices.pdf',     category: 'Field' },
    { slug: 'sharing-library',          title: 'Sharing the Library',                         url: './downloads/villageserver-sharing-the-library.pdf',                   category: 'Field' },
    { slug: 'setup-guide',              title: 'Setup Guide',                                 url: './downloads/villageserver-setup-guide.pdf',                           category: 'Field' },
    { slug: 'pamphlets-and-faq',        title: 'Printable Pamphlets and Field FAQ',           url: './downloads/villageserver-printable-pamphlets-and-field-faq.pdf',     category: 'Field' },
    { slug: 'kit-levels',               title: 'Field Configurations',                        url: './downloads/villageserver-kit-levels-and-costs.pdf',                  category: 'Technology' },
    { slug: 'rollout-and-reach',        title: 'Rollout and Reach',                           url: './downloads/villageserver-rollout-and-reach.pdf',                     category: 'Field' },
    { slug: 'field-faq',                title: 'Field FAQ',                                   url: './downloads/villageserver-field-faq.pdf',                             category: 'Field' },
    { slug: 'transfer-iphone-iphone',   title: 'iPhone to iPhone Transfer',                   url: './downloads/villageserver-transfer-iphone-to-iphone.pdf',             category: 'Transfer' },
    { slug: 'transfer-android-android', title: 'Android to Android Transfer',                 url: './downloads/villageserver-transfer-android-to-android.pdf',           category: 'Transfer' },
    { slug: 'transfer-iphone-android',  title: 'iPhone to Android Transfer',                  url: './downloads/villageserver-transfer-iphone-to-android.pdf',            category: 'Transfer' },
    { slug: 'transfer-android-iphone',  title: 'Android to iPhone Transfer',                  url: './downloads/villageserver-transfer-android-to-iphone.pdf',            category: 'Transfer' },
    { slug: 'transfer-computer-phone',  title: 'Computer to Phone Transfer',                  url: './downloads/villageserver-transfer-computer-to-phone.pdf',            category: 'Transfer' },
    { slug: 'transfer-microsd-phone',   title: 'microSD to Phone Transfer',                   url: './downloads/villageserver-transfer-microsd-to-phone.pdf',             category: 'Transfer' },
  ];
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const sbHeaders = await getSupabaseHeaders();

  // ── GET: return pamphlet list ──
  if (req.method === 'GET') {
    try {
      const pamphlets = await readPamphlets(supabaseUrl, sbHeaders);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(pamphlets);
    } catch (e) {
      return res.status(200).json(getDefaultPamphlets());
    }
  }

  // ── POST: admin save ──
  if (req.method === 'POST') {
    if (!isAuthorizedAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const { action, pamphlets } = body || {};
    if (action === 'save' && Array.isArray(pamphlets)) {
      const ok = await savePamphlets(supabaseUrl, sbHeaders, pamphlets);
      return res.status(ok ? 200 : 500).json({ ok });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
