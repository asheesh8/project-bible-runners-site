const { createClient } = require('@supabase/supabase-js');
const { isAuthorizedAdmin } = require('./_lib/admin-token.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === 'GET') {
    const page = ((req.query && req.query.page) || '').replace(/[^a-z0-9_-]/gi, '');
    if (!page) return res.status(400).json({ error: 'page param required' });
    try {
      const { data } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'page_content_' + page)
        .single();
      if (data && data.value) {
        const parsed = JSON.parse(data.value);
        return res.status(200).json(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {}
    return res.status(200).json([]);
  }

  if (req.method === 'POST') {
    if (!isAuthorizedAdmin(req)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const body = req.body || {};
    const page = (body.page || '').replace(/[^a-z0-9_-]/gi, '');
    const overrides = Array.isArray(body.overrides) ? body.overrides : [];
    if (!page) return res.status(400).json({ error: 'page required' });
    try {
      await supabase
        .from('site_settings')
        .upsert({ key: 'page_content_' + page, value: JSON.stringify(overrides) }, { onConflict: 'key' });
      return res.status(200).json({ ok: true, count: overrides.length });
    } catch (e) {
      return res.status(500).json({ error: 'save failed', detail: String(e) });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
};
