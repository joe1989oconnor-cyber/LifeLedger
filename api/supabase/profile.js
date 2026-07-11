// api/supabase/profile.js
// Reads and updates fields on the current user's profile row.
// Used to persist per-user settings like Moving Hub addresses across devices.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Fields on the profiles table that this endpoint is allowed to read/write.
const ALLOWED_FIELDS = ['move_from', 'move_to', 'move_date'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  // Verify the token and get the user id
  const userRes = await sb('/auth/v1/user', 'GET', null, token, SUPABASE_ANON_KEY);
  if (!userRes.id) return res.status(401).json({ error: 'Invalid token' });
  const userId = userRes.id;

  try {
    if (req.method === 'GET') {
      const rows = await sb(
        `/rest/v1/profiles?id=eq.${userId}&select=move_from,move_to,move_date`,
        'GET', null, null, SUPABASE_SERVICE_KEY
      );
      const profile = Array.isArray(rows) ? rows[0] : null;
      return res.status(200).json(profile || {});
    }

    if (req.method === 'POST') {
      // Only accept whitelisted fields
      const body = {};
      ALLOWED_FIELDS.forEach(function (f) {
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) {
          body[f] = req.body[f];
        }
      });
      if (Object.keys(body).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Try to update the existing profile row first
      const updated = await sb(
        `/rest/v1/profiles?id=eq.${userId}`,
        'PATCH', body, null, SUPABASE_SERVICE_KEY
      );

      // If PATCH matched no rows (no profile row exists), insert one via upsert
      const updatedRow = Array.isArray(updated) ? updated[0] : updated;
      if (!updatedRow || (Array.isArray(updated) && updated.length === 0)) {
        const insertBody = Object.assign({ id: userId }, body);
        const inserted = await sbUpsert(
          `/rest/v1/profiles`,
          insertBody,
          SUPABASE_SERVICE_KEY
        );
        const insertedRow = Array.isArray(inserted) ? inserted[0] : inserted;
        return res.status(200).json({ success: true, mode: 'insert', data: insertedRow });
      }

      return res.status(200).json({ success: true, mode: 'update', data: updatedRow });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[Profile] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function sb(path, method, body, token, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${token || apiKey}`,
    'Prefer': 'return=representation'
  };
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

// Upsert: insert a row, or merge into the existing one if the id already exists
async function sbUpsert(path, body, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Prefer': 'return=representation,resolution=merge-duplicates'
  };
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}
