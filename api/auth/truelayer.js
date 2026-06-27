// api/auth/truelayer.js
// Initiates TrueLayer OAuth flow — redirects user to bank selection screen

const crypto = require('crypto');

// Detect sandbox vs production from the client ID
function getAuthUrl() {
  const clientId = process.env.TRUELAYER_CLIENT_ID || '';
  const isSandbox = clientId.startsWith('sandbox-');
  return isSandbox
    ? 'https://auth.truelayer-sandbox.com'
    : 'https://auth.truelayer.com';
}

const SCOPES = 'info accounts balance transactions offline_access';

module.exports = async function handler(req, res) {
  console.log('[TrueLayer] /api/auth/truelayer called');

  const clientId = process.env.TRUELAYER_CLIENT_ID;

  if (!clientId) {
    console.error('[TrueLayer] ERROR: TRUELAYER_CLIENT_ID not set');
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto">
        <h2>⚠️ Configuration Error</h2>
        <p><strong>TRUELAYER_CLIENT_ID</strong> is not set in your Vercel environment variables.</p>
        <p><a href="/">← Back to LifeLedger</a></p>
      </body></html>
    `);
  }

  const isSandbox = clientId.startsWith('sandbox-');
  const TRUELAYER_AUTH_URL = getAuthUrl();

  console.log('[TrueLayer] Client ID:', clientId);
  console.log('[TrueLayer] Sandbox mode:', isSandbox);
  console.log('[TrueLayer] Auth URL:', TRUELAYER_AUTH_URL);

  // Build redirect URI
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/callback`;
  console.log('[TrueLayer] Redirect URI:', redirectUri);

  // Generate signed state (CSRF protection)
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now().toString();
  const statePayload = `${nonce}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', process.env.TRUELAYER_CLIENT_SECRET || 'dev');
  hmac.update(statePayload);
  const sig = hmac.digest('hex');
  const state = Buffer.from(`${statePayload}:${sig}`).toString('base64url');

  // Build auth URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: state,
    providers: 'uk-ob-all uk-oauth-all',
  });

  // Sandbox only: enable mock bank for testing
  if (isSandbox) {
    params.set('enable_mock', 'true');
  }

  const authUrl = `${TRUELAYER_AUTH_URL}/?${params.toString()}`;
  console.log('[TrueLayer] Redirecting to:', authUrl);

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
