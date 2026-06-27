// api/auth/truelayer.js
const crypto = require('crypto');

function getAuthUrl(clientId) {
  return clientId.startsWith('sandbox-')
    ? 'https://auth.truelayer-sandbox.com'
    : 'https://auth.truelayer.com';
}

const SCOPES = 'info accounts balance transactions offline_access';

module.exports = async function handler(req, res) {
  const clientId = process.env.TRUELAYER_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto">
        <h2>⚠️ Configuration Error</h2>
        <p><strong>TRUELAYER_CLIENT_ID</strong> is not set in your Vercel environment variables.</p>
        <p><a href="/">← Back to LifeLedger</a></p>
      </body></html>
    `);
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

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: state,
    nonce: nonce,
  });

  const authUrl = `${TRUELAYER_AUTH_URL}/?${params.toString()}`;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <html>
    <head><title>TrueLayer Debug</title></head>
    <body style="font-family:sans-serif;padding:40px;max-width:700px;margin:auto">
      <h2>🔍 TrueLayer Auth Debug</h2>
      <p>Copy the full URL below and send it to TrueLayer support.</p>
      
      <h3>Full Auth URL:</h3>
      <textarea style="width:100%;height:120px;font-family:monospace;font-size:12px;padding:10px">${authUrl}</textarea>
      
      <h3>Parameters:</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f0f0f0"><td style="padding:8px;border:1px solid #ccc;font-weight:bold">client_id</td><td style="padding:8px;border:1px solid #ccc">${clientId}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ccc;font-weight:bold">redirect_uri</td><td style="padding:8px;border:1px solid #ccc">${redirectUri}</td></tr>
        <tr style="background:#f0f0f0"><td style="padding:8px;border:1px solid #ccc;font-weight:bold">scope</td><td style="padding:8px;border:1px solid #ccc">${SCOPES}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ccc;font-weight:bold">auth_server</td><td style="padding:8px;border:1px solid #ccc">${TRUELAYER_AUTH_URL}</td></tr>
      </table>

      <br>
      <a href="${authUrl}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
        → Proceed to TrueLayer
      </a>
      &nbsp;
      <a href="/" style="color:#666">← Back to LifeLedger</a>
    </body>
    </html>
  `);
};

function getBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
