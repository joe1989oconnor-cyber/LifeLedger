// api/vehicle/lookup.js
// Uses DVSA MOT History API (OAuth 2.0 via Microsoft) for MOT data
// Falls back to DVLA VES API if that key is configured

let cachedToken = null;
let tokenExpiry = 0;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { registration } = req.body || {};
  if (!registration) return res.status(400).json({ error: 'Registration number required' });

  const reg = registration.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(reg)) {
    return res.status(400).json({ error: 'Invalid registration number format' });
  }

  console.log('[Vehicle] Looking up:', reg);

  try {
    // ── DVSA MOT History API ──────────────────────────────────────────────
    const dvsaKey = process.env.DVSA_API_KEY;
    const clientId = process.env.DVSA_CLIENT_ID;
    const clientSecret = process.env.DVSA_CLIENT_SECRET;
    const tokenUrl = process.env.DVSA_TOKEN_URL;
    const scopeUrl = process.env.DVSA_SCOPE_URL;

    // Diagnostic — logs which credentials are present (never logs the actual values)
    console.log('[Vehicle] Env check:', {
      DVSA_API_KEY: dvsaKey ? 'set' : 'MISSING',
      DVSA_CLIENT_ID: clientId ? 'set' : 'MISSING',
      DVSA_CLIENT_SECRET: clientSecret ? 'set' : 'MISSING',
      DVSA_TOKEN_URL: tokenUrl ? 'set' : 'MISSING',
      DVSA_SCOPE_URL: scopeUrl ? 'set' : 'MISSING'
    });

    if (dvsaKey && clientId && clientSecret && tokenUrl) {
      const token = await getDvsaToken(clientId, clientSecret, tokenUrl, scopeUrl);
      if (token) {
        const r = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`, {
          headers: {
            'Authorization': 'Bearer ' + token,
            'X-API-Key': dvsaKey,
            'Accept': 'application/json'
          }
        });

        if (r.ok) {
          const d = await r.json();
          const tests = d.motTests || [];
          const latest = tests[0] || {};
          return res.status(200).json({
            registration: reg,
            make: d.make || '',
            model: d.model || '',
            colour: d.primaryColour || '',
            fuelType: d.fuelType || '',
            year: d.firstUsedDate ? d.firstUsedDate.slice(0, 4) : (d.manufactureDate ? d.manufactureDate.slice(0,4) : ''),
            motStatus: latest.testResult || '',
            motExpiry: latest.expiryDate || '',
            motHistory: tests.slice(0, 5).map(t => ({
              date: t.completedDate,
              result: t.testResult,
              mileage: t.odometerValue,
              expiry: t.expiryDate,
              advisories: (t.defects || t.rfrAndComments || [])
                .filter(x => x.type === 'ADVISORY' || x.type === 'MINOR')
                .map(x => x.text).slice(0, 3)
            })),
            source: 'dvsa'
          });
        } else {
          const errText = await r.text();
          console.error('[DVSA] API error:', r.status, errText);
          if (r.status === 404) {
            return res.status(200).json({
              registration: reg, make: '', model: '', colour: '', fuelType: '', year: '',
              motStatus: '', motExpiry: '', motHistory: [],
              source: 'manual',
              message: 'No MOT records found for this registration — enter details manually'
            });
          }
        }
      }
    }

    // ── DVLA VES API fallback ─────────────────────────────────────────────
    const dvlaKey = process.env.DVLA_API_KEY;
    if (dvlaKey) {
      const r = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': dvlaKey },
        body: JSON.stringify({ registrationNumber: reg })
      });
      if (r.ok) {
        const d = await r.json();
        return res.status(200).json({
          registration: reg,
          make: d.make || '',
          colour: d.colour || '',
          fuelType: d.fuelType || '',
          engineSize: d.engineCapacity ? d.engineCapacity + 'cc' : '',
          year: d.yearOfManufacture ? String(d.yearOfManufacture) : '',
          motStatus: d.motStatus || '',
          motExpiry: d.motExpiryDate || '',
          taxStatus: d.taxStatus || '',
          taxDue: d.taxDueDate || '',
          motHistory: [],
          source: 'dvla'
        });
      }
    }

    // ── No API configured — manual entry ──────────────────────────────────
    return res.status(200).json({
      registration: reg, make: '', model: '', colour: '', fuelType: '', year: '',
      motStatus: '', motExpiry: '', taxStatus: '', taxDue: '',
      motHistory: [],
      source: 'manual',
      message: 'Enter vehicle details manually below'
    });

  } catch (err) {
    console.error('[Vehicle] Error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve vehicle data' });
  }
};

// ── Get DVSA OAuth token (cached for its lifetime) ────────────────────────
async function getDvsaToken(clientId, clientSecret, tokenUrl, scopeUrl) {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', scopeUrl || 'https://tapi.dvsa.gov.uk/.default');

    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[DVSA] Token error:', r.status, errText);
      return null;
    }

    const data = await r.json();
    cachedToken = data.access_token;
    // Token valid for expires_in seconds — cache for 90% of that time
    tokenExpiry = Date.now() + (data.expires_in || 3600) * 900;
    console.log('[DVSA] Token obtained, expires in', data.expires_in, 'seconds');
    return cachedToken;
  } catch (e) {
    console.error('[DVSA] Token fetch error:', e.message);
    return null;
  }
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*');
  return origin === allowed ? origin : allowed;
}
