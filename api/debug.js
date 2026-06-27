// api/debug.js
// Temporary diagnostic endpoint — shows exactly what the app thinks its URL is
// Visit /api/debug to see the values, then delete this file

module.exports = function handler(req, res) {
  const appUrl = process.env.APP_URL || null;
  const vercelUrl = process.env.VERCEL_URL || null;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const fromHeaders = `${proto}://${host}`;

  const baseUrl = appUrl
    ? appUrl.replace(/\/$/, '')
    : vercelUrl
    ? `https://${vercelUrl}`
    : fromHeaders;

  const redirectUri = `${baseUrl}/api/auth/callback`;
  const clientId = process.env.TRUELAYER_CLIENT_ID || 'NOT SET';
  const isSandbox = clientId.startsWith('sandbox-');

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <html>
    <body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto;background:#f9f9f9">
      <h2>🔍 LifeLedger Diagnostic</h2>

      <h3>Environment Variables</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#e8f5e9">
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">TRUELAYER_CLIENT_ID</td>
          <td style="padding:10px;border:1px solid #ccc">${clientId}</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">APP_URL</td>
          <td style="padding:10px;border:1px solid #ccc">${appUrl || '<span style="color:red">NOT SET</span>'}</td>
        </tr>
        <tr style="background:#e8f5e9">
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">VERCEL_URL</td>
          <td style="padding:10px;border:1px solid #ccc">${vercelUrl || 'not set'}</td>
        </tr>
      </table>

      <h3>Computed Values</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#fff3e0">
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">Base URL used</td>
          <td style="padding:10px;border:1px solid #ccc"><strong>${baseUrl}</strong></td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">Redirect URI sent to TrueLayer</td>
          <td style="padding:10px;border:1px solid #ccc;color:blue"><strong>${redirectUri}</strong></td>
        </tr>
        <tr style="background:#fff3e0">
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold">Sandbox mode</td>
          <td style="padding:10px;border:1px solid #ccc">${isSandbox ? '✅ Yes (using auth.truelayer-sandbox.com)' : '❌ No (using auth.truelayer.com)'}</td>
        </tr>
      </table>

      <h3 style="color:blue">What to do</h3>
      <p>The <strong>Redirect URI sent to TrueLayer</strong> value above must match <strong>exactly</strong> what is registered in your TrueLayer console.</p>
      <p>Copy the blue value and paste it into TrueLayer → Redirect URIs.</p>

      <p style="margin-top:30px"><a href="/">← Back to LifeLedger</a></p>
    </body>
    </html>
  `);
};
