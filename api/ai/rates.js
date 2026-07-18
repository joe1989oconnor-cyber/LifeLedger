// api/ai/rates.js
// Server-side proxy for AI-generated UK utility rate data.
//
// Why this exists: the browser cannot call api.anthropic.com directly (CORS),
// and even if it could, the API key would be exposed in the frontend.
// This endpoint keeps the key server-side and caches responses at the CDN
// so we aren't billed for an API call on every page load.
//
// Required Vercel env var: ANTHROPIC_API_KEY
// Optional:               ANTHROPIC_MODEL  (defaults below)

const DEFAULT_MODEL = 'claude-sonnet-5';

const PROMPTS = {
  // Dashboard "live rates" banner — small array of headline providers
  dashboard: 'Return ONLY a JSON array (no markdown, no explanation) of current UK utility rates for these 6 providers. '
    + 'Each object: {id,monthlyGBP,savingVsAvgGBP,tagline}. Use realistic current UK prices. '
    + 'Providers: octopus (energy, ~£89/mo avg household), eon (energy, ~£112/mo), '
    + 'communityfibre (broadband, £28/mo), bt (broadband, £39/mo), '
    + 'lv (insurance, £42/mo), admiral (insurance, £48/mo). '
    + 'savingVsAvgGBP is how much cheaper vs UK average for that category '
    + '(energy avg £152, broadband avg £52, insurance avg £58). '
    + 'The id values must be exactly: octopus, eon, communityfibre, bt, lv, admiral. '
    + 'Return raw JSON array only.',

  // Compare & Switch page — full grouped comparison table
  compare: 'Return ONLY a JSON object (no markdown) with realistic current UK utility rates. '
    + 'Format: {"energy":[...],"broadband":[...],"insurance":[...],"mortgage":[...]}. '
    + 'Each item: {id,name,price,tag,url,sponsored}. price is a monthly GBP number. '
    + 'Energy (combined gas+electric monthly): Octopus Tracker ~96.50 (sponsored:true), E.ON Next Fixed ~108, '
    + 'British Gas Standard ~120, EDF Blue ~113, Bulb ~104. '
    + 'Broadband (monthly): Community Fibre 900Mbps 28 (sponsored:true), BT Full Fibre 150 38.99, '
    + 'Vodafone Pro II 34, Sky Ultrafast 43.99, Virgin M500 37. '
    + 'Insurance (monthly home+car): LV= Bundle 82 (sponsored:true), Admiral Multi 76, '
    + 'Aviva Home+Car 94, Direct Line 88. '
    + 'Mortgage (monthly on £200k): Halifax 2yr fixed 1095 (sponsored:true), '
    + 'Nationwide 5yr fixed 1042, Barclays 2yr fixed 1088. '
    + 'URLs should be the provider homepages (e.g. https://octopus.energy). '
    + 'Return raw JSON only.'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = (req.query && req.query.type) || 'dashboard';
  const prompt = PROMPTS[type];
  if (!prompt) {
    return res.status(400).json({ error: 'Invalid type. Use "dashboard" or "compare".' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not an error the user should see — the frontend falls back to cached rates.
    console.warn('[AI Rates] ANTHROPIC_API_KEY not set — telling client to use fallback');
    return res.status(503).json({ error: 'AI rates not configured', fallback: true });
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: type === 'compare' ? 1500 : 900,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('[AI Rates] Anthropic error:', r.status, JSON.stringify(data).slice(0, 300));
      return res.status(502).json({ error: 'Rates service unavailable', fallback: true });
    }

    let txt = (data.content && data.content[0] && data.content[0].text) || '';
    txt = txt.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      console.error('[AI Rates] Could not parse response:', txt.slice(0, 200));
      return res.status(502).json({ error: 'Bad rates response', fallback: true });
    }

    // Cache at the CDN for 6 hours, serve stale for up to 24h while revalidating.
    // Rates don't change minute to minute, and this keeps API costs down as usage grows.
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ success: true, type: type, data: parsed });

  } catch (err) {
    console.error('[AI Rates] Error:', err.message);
    return res.status(502).json({ error: 'Rates service unavailable', fallback: true });
  }
};

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}
