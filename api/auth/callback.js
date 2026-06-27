// api/auth/callback.js
// Exchanges auth code for tokens server-side

const crypto = require('crypto');

function getAuthUrl() {
  const clientId = process.env.TRUELAYER_CLIENT_ID || '';
  return clientId.startsWith('sandbox-')
    ? 'https://auth.truelayer-sandbox.com'
    : 'https://auth.truelayer.com';
}

module.exports = async function handler(req, res) {
  const { code, state, error, error_description } = req.query;
  console.log('[Callback] Received:', { code: !!code, state: !!state, error });

  if (error) {
    console.error('[Callback] TrueLayer error:', error, error_description);
    return redirectToApp(res, req, {
      bank_callback: '1',
      error: 'auth_failed',
      message: error_description || 'Bank connection was cancelled'
    });
  }

  if (!code) {
    return redirectToApp(res, req, {
      bank_callback: '1',
      error: 'missing_code',
      message: 'No authorisation code received from TrueLayer'
    });
  }

  // Verify state
  if (state && process.env.TRUELAYER_CLIENT_SECRET) {
    try {
      const decoded = Buffer.from(state, 'base64url').toString();
      const parts = decoded.split(':');
      if (parts.length === 3) {
        const [nonce, timestamp, receivedSig] = parts;
        const hmac = crypto.createHmac('sha256', process.env.TRUELAYER_CLIENT_SECRET);
        hmac.update(`${nonce}:${timestamp}`);
        const expectedSig = hmac.digest('hex');
        const age = Date.now() - parseInt(timestamp);
        if (age > 600000) throw new Error('State expired');
        if (!crypto.timingSafeEqual(
          Buffer.from(receivedSig, 'hex'),
          Buffer.from(expectedSig, 'hex')
        )) throw new Error('State mismatch');
        console.log('[Callback] State verified OK');
      }
    } catch (err) {
      console.error('[Callback] State verification failed:', err.message);
      return redirectToApp(res, req, {
        bank_callback: '1',
        error: 'invalid_state',
        message: 'Security check failed — please try connecting again'
      });
    }
  }

  // Exchange code for tokens
  const TRUELAYER_AUTH_URL = getAuthUrl();
  const redirectUri = `${getBaseUrl(req)}/api/auth/callback`;
  console.log('[Callback] Token exchange, auth URL:', TRUELAYER_AUTH_URL);
  console.log('[Callback] Redirect URI:', redirectUri);

  try {
    const tokenRes = await fetch(`${TRUELAYER_AUTH_URL}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.TRUELAYER_CLIENT_ID,
        client_secret: process.env.TRUELAYER_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      })
    });

    const body = await tokenRes.text();
    console.log('[Callback] Token response status:', tokenRes.status);

    if (!tokenRes.ok) {
      console.error('[Callback] Token exchange failed:', body.slice(0, 300));
      return redirectToApp(res, req, {
        bank_callback: '1',
        error: 'token_failed',
        message: 'Failed to complete bank connection — please try again'
      });
    }

    const tokens = JSON.parse(body);
    const { access_token, expires_in = 3600 } = tokens;
    const expiresAt = Date.now() + expires_in * 1000;
    const tokenData = Buffer.from(JSON.stringify({ access_token, expires_at: expiresAt })).toString('base64url');

    res.setHeader('Set-Cookie', [
      `tl_token=${tokenData}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${expires_in}`,
      `tl_connected=1; Secure; SameSite=Lax; Path=/; Max-Age=3600`,
    ]);

    console.log('[Callback] Success — redirecting to app');
    return redirectToApp(res, req, { bank_callback: '1', success: 'true' });

  } catch (err) {
    console.error('[Callback] Error:', err.message);
    return redirectToApp(res, req, {
      bank_callback: '1',
      error: 'server_error',
      message: 'An unexpected error occurred'
    });
  }
};

function getBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function redirectToApp(res, req, params) {
  const base = getBaseUrl(req);
  const qs = new URLSearchParams(params).toString();
  res.writeHead(302, { Location: `${base}/?${qs}` });
  res.end();
}
