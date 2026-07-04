module.exports = async function handler(req, res) {
  const { token_hash, type } = req.query;
  const baseUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
  if (!token_hash || type !== 'recovery') {
    return res.redirect(302, `${baseUrl}/?error=invalid_reset_link`);
  }
  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ token_hash, type: 'recovery' })
    });
    const data = await verifyRes.json();
    const accessToken = data.access_token || (data.session && data.session.access_token);
    if (accessToken) {
      return res.redirect(302, `${baseUrl}/#access_token=${accessToken}&type=recovery`);
    } else {
      return res.redirect(302, `${baseUrl}/?error=reset_link_expired`);
    }
  } catch (err) {
    return res.redirect(302, `${baseUrl}/?error=reset_failed`);
  }
};
