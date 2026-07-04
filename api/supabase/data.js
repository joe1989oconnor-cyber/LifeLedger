// api/supabase/data.js
// Handles all data operations — bills, budgets, inventory, docs
// Called by the frontend to load and save user data

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Get user from token
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await sb(`/auth/v1/user`, 'GET', null, token);
  if (!userRes.id) return res.status(401).json({ error: 'Invalid token' });
  const userId = userRes.id;

  const { table, id } = req.query;
  const validTables = ['bills', 'budgets', 'inventory', 'docs', 'members', 'properties', 'tenants', 'vehicles', 'notes'];
  if (!validTables.includes(table)) return res.status(400).json({ error: 'Invalid table: ' + table });

  try {
    // GET — load all rows for this user
    if (req.method === 'GET') {
      const rows = await sb(`/rest/v1/${table}?user_id=eq.${userId}&order=created_at.asc`, 'GET', null, null, true);
      return res.status(200).json({ data: Array.isArray(rows) ? rows : [] });
    }

    // POST — create new row
    if (req.method === 'POST') {
      const body = { ...req.body, user_id: userId };
      delete body.id; // Let Supabase generate the ID
      const row = await sb(`/rest/v1/${table}`, 'POST', body, null, true);
      return res.status(201).json({ data: Array.isArray(row) ? row[0] : row });
    }

    // PUT — update existing row
    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'ID required for update' });
      const body = { ...req.body, user_id: userId };
      delete body.id;
      const row = await sb(`/rest/v1/${table}?id=eq.${id}&user_id=eq.${userId}`, 'PATCH', body, null, true);
      return res.status(200).json({ data: Array.isArray(row) ? row[0] : row });
    }

    // DELETE — remove row
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'ID required for delete' });
      await sb(`/rest/v1/${table}?id=eq.${id}&user_id=eq.${userId}`, 'DELETE', null, null, true);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error(`[Data] ${req.method} ${table} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function sb(path, method, body, token, service) {
  const key = service ? SUPABASE_SERVICE_KEY : process.env.SUPABASE_ANON_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${token || key}`,
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
