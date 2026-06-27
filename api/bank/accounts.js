// api/bank/accounts.js
// Fetches the user's bank accounts from TrueLayer
// Called by the frontend after successful OAuth connection
// The access token is read from the httpOnly cookie (never exposed in JS)

const TRUELAYER_API = 'https://api.truelayer.com';

module.exports = async function handler(req, res) {
  // CORS headers for same-origin requests
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Read access token from httpOnly cookie
  const token = getTokenFromCookie(req);
  if (!token) {
    return res.status(401).json({
      error: 'not_connected',
      message: 'No bank connection found — please connect your bank first'
    });
  }

  try {
    const response = await fetch(`${TRUELAYER_API}/data/v1/accounts`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json; charset=UTF-8'
      }
    });

    if (response.status === 401) {
      // Token expired — clear cookie and ask user to reconnect
      res.setHeader('Set-Cookie', [
        'tl_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
        'tl_connected=; Secure; SameSite=Lax; Path=/; Max-Age=0'
      ]);
      return res.status(401).json({
        error: 'token_expired',
        message: 'Bank connection has expired — please reconnect your bank'
      });
    }

    if (!response.ok) {
      const body = await response.text();
      console.error('TrueLayer accounts error:', response.status, body);
      return res.status(502).json({
        error: 'upstream_error',
        message: 'Could not fetch accounts from your bank'
      });
    }

    const data = await response.json();

    // Return sanitised account data (no sensitive fields)
    const accounts = (data.results || []).map(account => ({
      account_id: account.account_id,
      account_type: account.account_type,
      display_name: account.display_name,
      currency: account.currency,
      provider: {
        display_name: account.provider?.display_name || 'Your bank',
        logo_uri: account.provider?.logo_uri || null
      }
    }));

    return res.status(200).json({ accounts });

  } catch (err) {
    console.error('Accounts fetch error:', err);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to fetch accounts'
    });
  }
};

function getTokenFromCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
  const encoded = cookies['tl_token'];
  if (!encoded) return null;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (decoded.expires_at && decoded.expires_at < Date.now()) return null;
    return decoded.access_token;
  } catch {
    return null;
  }
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}
