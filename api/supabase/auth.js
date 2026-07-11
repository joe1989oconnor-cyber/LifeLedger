// api/supabase/auth.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, name, mode } = req.body || {};
  console.log('[Auth] Action:', action);

  try {
    if (action === 'signup') {
      const authRes = await sb('/auth/v1/signup', 'POST', { email, password });
      console.log('[Auth] Signup response keys:', Object.keys(authRes));

      if (authRes.error) return res.status(400).json({ error: authRes.error.message || 'Signup failed' });

      // Extract user ID from wherever Supabase puts it
      const userId = authRes.user?.id || authRes.id || null;
      // When confirmation is OFF, Supabase returns the token inside `session`;
      // some versions put it at the top level. Check both.
      const accessToken = authRes.access_token
        || (authRes.session && authRes.session.access_token)
        || null;
      const refreshToken = authRes.refresh_token
        || (authRes.session && authRes.session.refresh_token)
        || null;

      // When email confirmation is ON and it's a NEW user:
      // Supabase returns { user: { id, email, ... }, session: null }
      // When confirmation is OFF: returns { user: {...}, session: { access_token, ... } }
      // When email already exists + confirmation ON: returns same empty-session response (by design)

      // If we have a userId, create the profile and return success
      if (userId) {
        try {
          await sb('/rest/v1/profiles', 'POST', {
            id: userId, name: name || email.split('@')[0], email, mode: mode || 'individual'
          }, null, true);
        } catch(e) {
          console.log('[Auth] Profile insert note:', e.message);
        }

        if (!accessToken) {
          // Email confirmation required — tell frontend to show check email screen
          return res.status(200).json({
            success: true,
            requiresConfirmation: true,
            user: { id: userId, email, name: name || email.split('@')[0], mode: mode || 'individual' }
          });
        }

        // No confirmation required — sign straight in
        return res.status(200).json({
          success: true,
          requiresConfirmation: false,
          user: { id: userId, email, name: name || email.split('@')[0], mode: mode || 'individual', is_pro: false },
          access_token: accessToken,
          refresh_token: refreshToken
        });
      }

      // No userId at all — this happens when Supabase returns an empty object
      // This is Supabase's security behaviour when confirmation is on
      // Treat as: confirmation email sent (we can't distinguish new vs existing)
      console.log('[Auth] No userId in response — treating as confirmation required');
      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        user: { email, name: name || email.split('@')[0], mode: mode || 'individual' }
      });
    }

    if (action === 'signin') {
      const authRes = await sb('/auth/v1/token?grant_type=password', 'POST', { email, password });
      if (authRes.error) return res.status(401).json({ error: 'Invalid email or password' });
      const userId = authRes.user?.id;
      const profiles = await sb(`/rest/v1/profiles?id=eq.${userId}&select=*`, 'GET', null, null, true);
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      return res.status(200).json({
        success: true,
        user: {
          id: userId,
          email: authRes.user.email,
          name: profile?.name || authRes.user.email.split('@')[0],
          mode: profile?.mode || 'individual',
          is_pro: profile?.is_pro || false
        },
        access_token: authRes.access_token,
        refresh_token: authRes.refresh_token
      });
    }

    if (action === 'signout') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (token) await sb('/auth/v1/logout', 'POST', null, token);
      return res.status(200).json({ success: true });
    }

    if (action === 'restore') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'No token' });
      const userRes = await sb('/auth/v1/user', 'GET', null, token);
      if (!userRes.id) return res.status(401).json({ error: 'Invalid token' });
      const profiles = await sb(`/rest/v1/profiles?id=eq.${userRes.id}&select=*`, 'GET', null, null, true);
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      return res.status(200).json({
        success: true,
        user: {
          id: userRes.id,
          email: userRes.email,
          name: profile?.name || userRes.email.split('@')[0],
          mode: profile?.mode || 'individual',
          is_pro: profile?.is_pro || false
        }
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('[Auth] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function sb(path, method, body, token, service) {
  const key = service ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${token || key}`
  };
  if (service && method === 'POST') headers['Prefer'] = 'return=representation';
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}
