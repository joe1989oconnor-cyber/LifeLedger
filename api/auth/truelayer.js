// api/auth/truelayer.js
const crypto = require('crypto');

function getAuthUrl(clientId) {
  return clientId.startsWith('sandbox-')
    ? 'https://auth.truelayer-sandbox.com'
    : 'https://auth.truelayer.com';
}

module.exports = async function handler(req, res) {
  const clientId = process.env.TRUELAYER_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send(`<html><body style="font-family:sans-serif;padding:40px">
      <h2>⚠️ TRUELAYER_CLIENT_ID not set in Vercel environment variables</h2>
      <a href="/">← Back</a></body></html>`);
  }

  const TRUELAYER_AUTH_URL = getAuthUrl(clientId);
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/callback`;

  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now().toString();
  const statePayload = `${nonce}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', process.env.TRUELAYER_CLIENT_SECRET || 'dev');
  hmac.update(statePayload);
  const sig = hmac.digest('hex');
  const state = Buffer.from(`${statePayload}:${sig}`).toString('base64url');

  const authUrl = `${TRUELAYER_AUTH_URL}/?`
    + `response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&scope=info%20accounts%20balance%20transactions%20offline_access`
    + `&state=${encodeURIComponent(state)}`;

  console.log('[TrueLayer] Auth URL:', authUrl);

  res.setHeader('Set-Cookie',
    `tl_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  res.writeHead(302, { Location: authUrl });
  res.end();
};

function getBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
