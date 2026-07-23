import crypto from 'node:crypto';
import { isAuthorizedAdmin } from './_lib/admin-token.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

function env(name) {
  return String(process.env[name] || '').trim();
}

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  return `${proto}://${host}`;
}

function signState(expiry) {
  return crypto.createHmac('sha256', env('ADMIN_PASSWORD')).update(String(expiry)).digest('hex');
}

function makeState() {
  const expiry = Date.now() + 15 * 60 * 1000;
  return `${expiry}.${signState(expiry)}`;
}

function verifyState(state) {
  const [expiryRaw, sig] = String(state || '').split('.');
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < Date.now() || !sig || !env('ADMIN_PASSWORD')) return false;
  const expected = signState(expiry);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function htmlPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:780px;margin:48px auto;padding:0 20px;line-height:1.5;color:#17283c}code,textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}textarea{width:100%;height:120px}pre{white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px}</style></head><body>${body}</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = env('GMAIL_CLIENT_ID');
  const clientSecret = env('GMAIL_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return res.status(503).send(htmlPage('Gmail OAuth not configured', '<h1>Gmail OAuth not configured</h1><p>Add <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> to Vercel first.</p>'));
  }

  const redirectUri = `${baseUrl(req)}/api/intake-gmail-oauth?action=callback`;
  const action = String(req.query.action || 'auth-url');

  if (action === 'auth-url') {
    if (!isAuthorizedAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', makeState());
    return res.status(200).json({ auth_url: url.toString(), redirect_uri: redirectUri, scopes: SCOPES.split(' ') });
  }

  if (action !== 'callback') return res.status(400).json({ error: 'Unknown action.' });
  if (!verifyState(req.query.state)) {
    return res.status(401).send(htmlPage('Invalid state', '<h1>Invalid or expired OAuth state</h1><p>Go back to the admin panel and generate a fresh Gmail auth URL.</p>'));
  }
  const code = String(req.query.code || '');
  if (!code) return res.status(400).send(htmlPage('Missing code', '<h1>Missing OAuth code</h1>'));

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.refresh_token) {
    return res.status(502).send(htmlPage('OAuth exchange failed', `<h1>OAuth exchange failed</h1><pre>${String(JSON.stringify(data, null, 2)).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre><p>If Google did not return a refresh token, revoke the app access and try again with <code>prompt=consent</code>.</p>`));
  }
  return res.status(200).send(htmlPage('Gmail refresh token', `<h1>Gmail connected</h1><p>Add this value to Vercel as <code>GMAIL_REFRESH_TOKEN</code>. Do not commit it to the repo.</p><textarea readonly>${data.refresh_token}</textarea><p>Then set <code>EMAIL_PROVIDER=gmail</code> if you want Laura to send directly as the Gmail account. If you leave <code>EMAIL_PROVIDER=resend</code>, Gmail will only be used for reading replies.</p>`));
}
