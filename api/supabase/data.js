// api/supabase/data.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  // Verify the user token and get userId
  const userRes = await sbWithKey(`/auth/v1/user`, 'GET', null, token, SUPABASE_ANON_KEY);
  if (!userRes.id) return res.status(401).json({ error: 'Invalid token' });
  const userId = userRes.id;

  const { table, id, deleteAll } = req.query;
  const validTables = ['bills', 'budgets', 'inventory', 'docs', 'members', 'properties', 'tenants', 'vehicles', 'notes'];
  if (!validTables.includes(table)) return res.status(400).json({ error: 'Invalid table: ' + table });

  try {
    // GET — use user's own token so RLS enforces data isolation
    if (req.method === 'GET') {
      const rows = await sbWithKey(
        `/rest/v1/${table}?user_id=eq.${userId}&order=created_at.asc`,
        'GET', null, token, SUPABASE_ANON_KEY
      );
      return res.status(200).json({ data: Array.isArray(rows) ? rows : [] });
    }

    // POST — use service key to insert with user_id
    if (req.method === 'POST') {
      const body = { ...req.body, user_id: userId };
      delete body.id;
      const row = await sbWithKey(`/rest/v1/${table}`, 'POST', body, null, SUPABASE_SERVICE_KEY);
      return res.status(201).json({ data: Array.isArray(row) ? row[0] : row });
    }

    // PUT — use service key but always enforce user_id in filter
    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'ID required for update' });
      const body = { ...req.body, user_id: userId };
      delete body.id;
      const row = await sbWithKey(
        `/rest/v1/${table}?id=eq.${id}&user_id=eq.${userId}`,
        'PATCH', body, null, SUPABASE_SERVICE_KEY
      );
      return res.status(200).json({ data: Array.isArray(row) ? row[0] : row });
    }

    // DELETE
    if (req.method === 'DELETE') {
      if (deleteAll === '1') {
        await sbWithKey(`/rest/v1/${table}?user_id=eq.${userId}`, 'DELETE', null, null, SUPABASE_SERVICE_KEY);
        return res.status(200).json({ success: true });
      }
      if (!id) return res.status(400).json({ error: 'ID required for delete' });
      await sbWithKey(`/rest/v1/${table}?id=eq.${id}&user_id=eq.${userId}`, 'DELETE', null, null, SUPABASE_SERVICE_KEY);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error(`[Data] ${req.method} ${table} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function sbWithKey(path, method, body, userToken, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${userToken || apiKey}`,
    'Prefer': 'return=representation'
  };
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
