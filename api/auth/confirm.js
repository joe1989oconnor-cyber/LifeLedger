module.exports = async function handler(req, res) {
  const { token_hash, type } = req.query;
  const baseUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;

  if (!token_hash || type !== 'signup') {
    return res.redirect(302, `${baseUrl}/?error=invalid_link`);
  }

  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ token_hash, type: 'signup' })
    });

    const data = await verifyRes.json();
    const accessToken = data.access_token || 
      (data.session && data.session.access_token);

    if (accessToken) {
      return res.redirect(302, 
        `${baseUrl}/#access_token=${accessToken}&type=signup`);
    } else {
      return res.redirect(302, `${baseUrl}/?error=confirm_link_expired`);
    }
  } catch (err) {
    console.error('[Confirm] Error:', err.message);
    return res.redirect(302, `${baseUrl}/?error=confirm_failed`);
  }
};
