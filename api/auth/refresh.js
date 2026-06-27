// api/auth/refresh.js
// Silently refreshes an expired access token using the refresh token
// NOTE: In production with Supabase, the refresh token is stored server-side
// This endpoint would be called automatically when a 401 is received

const TRUELAYER_AUTH_URL = 'https://auth.truelayer.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // In a full Supabase implementation, you would:
  // 1. Read the user's session from Supabase (verified JWT)
  // 2. Look up their refresh_token from the database
  // 3. Exchange it for a new access_token
  // 4. Update the stored token in Supabase
  // 5. Return the new access_token

  // For now, return an instruction to reconnect
  // This will be replaced once Supabase is integrated
  return res.status(401).json({
    error: 'refresh_not_available',
    message: 'Please reconnect your bank',
    action: 'reconnect'
  });
};
