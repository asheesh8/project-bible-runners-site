// Vercel serverless function — admin auth
// Env var: ADMIN_PASSWORD

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const { ADMIN_PASSWORD } = process.env;

  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin not configured. Set ADMIN_PASSWORD env var in Vercel.' });
  if (password === ADMIN_PASSWORD) return res.status(200).json({ token: ADMIN_PASSWORD });
  return res.status(401).json({ error: 'Incorrect password' });
}
