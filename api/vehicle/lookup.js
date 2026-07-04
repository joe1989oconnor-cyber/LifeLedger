// api/vehicle/lookup.js
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
    // Try DVLA VES API if key available
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
          source: 'dvla'
        });
      }
    }

    // Try DVSA MOT API if key available
    const dvsaKey = process.env.DVSA_API_KEY;
    if (dvsaKey) {
      const r = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${reg}`, {
        headers: { 'x-api-key': dvsaKey, 'Accept': 'application/json' }
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
          year: d.firstUsedDate ? d.firstUsedDate.slice(0,4) : '',
          motStatus: latest.testResult || '',
          motExpiry: latest.expiryDate || '',
          motHistory: tests.slice(0,5).map(t => ({
            date: t.completedDate,
            result: t.testResult,
            mileage: t.odometerValue,
            expiry: t.expiryDate,
            advisories: (t.rfrAndComments||[]).filter(r=>r.type==='ADVISORY').map(r=>r.text).slice(0,3)
          })),
          source: 'dvsa'
        });
      }
    }

    // No API keys — return manual entry prompt
    return res.status(200).json({
      registration: reg,
      make: '', model: '', colour: '', fuelType: '', year: '',
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

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*');
  return origin === allowed ? origin : allowed;
}
