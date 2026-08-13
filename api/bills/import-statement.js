// api/bills/import-statement.js
//
// Reads an uploaded UK bank statement (PDF) and extracts recurring bills.
//
//   POST /api/bills/import-statement   body: { pdf: "<base64>", filename: "x.pdf" }
//   → { success: true, bills: [ {prov,cat,amt,freq,source}, ... ] }
//
// Design decisions:
//  - We send the PDF straight to Claude's document API rather than parsing text
//    ourselves. That means NO pdf-parse / external npm dependency (the project
//    has no package.json and every other endpoint is dependency-free), and
//    Claude reads native PDF layout better than a text-extraction library would.
//  - The statement is never written to disk or stored. It lives in memory for
//    the duration of the request and is discarded when the function returns.
//  - This is a *grounded* use of AI: it extracts what is genuinely in the
//    document. It does not invent figures. (Contrast with the deleted ai/rates.js,
//    which fed the model prices and had it read them back.)
//
// Required Vercel env var: ANTHROPIC_API_KEY
// Optional:               ANTHROPIC_MODEL (defaults below)

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB

// The only categories the app understands — the model must map to one of these.
const CATEGORIES = [
  'Gas', 'Electricity', 'Water', 'Internet & Broadband', 'TV & Streaming',
  'Council Tax', 'Home Insurance', 'Car Insurance', 'Mortgage / Rent', 'Other'
];

const EXTRACTION_PROMPT =
  'You are reading a UK bank statement. Identify RECURRING HOUSEHOLD BILLS only — '
  + 'regular payments to utility, telecoms, insurance, council, streaming, or '
  + 'mortgage/rent providers. \n\n'
  + 'INCLUDE: energy (gas/electric), water, broadband/phone, TV/streaming, council tax, '
  + 'home/car insurance, mortgage or rent.\n'
  + 'EXCLUDE: one-off purchases, shopping, groceries, restaurants, cash withdrawals, '
  + 'transfers to people, salary/income, and anything that is not a recurring household bill.\n\n'
  + 'For each bill return an object with exactly these fields:\n'
  + '  prov   — the provider name, cleaned up (e.g. "BRITISH GAS DD" → "British Gas")\n'
  + '  cat    — MUST be exactly one of: ' + CATEGORIES.join(', ') + '\n'
  + '  amt    — the monthly amount as a number in GBP (no currency symbol)\n'
  + '  freq   — "Monthly" (use this unless clearly otherwise)\n'
  + '  lastPaid — the date this bill was most recently paid, as it appears on the '
  + 'statement, in YYYY-MM-DD format. If you cannot determine a date, use null.\n'
  + '  source — the raw transaction description exactly as it appears on the statement\n\n'
  + 'If the same provider appears multiple times, return it ONCE using the most recent amount. '
  + 'If you are unsure whether something is a household bill, leave it out. '
  + 'It is better to miss a bill than to invent one.\n\n'
  + 'Return ONLY a JSON array of these objects. No markdown, no commentary, no code fences. '
  + 'If you find no recurring bills, return an empty array [].';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Statement import is not configured yet.' });
  }

  // Body may arrive parsed (Vercel auto-parses JSON) or as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ success: false, error: 'Invalid request body' }); }
  }
  if (!body || !body.pdf) {
    return res.status(400).json({ success: false, error: 'No PDF provided' });
  }

  // Strip a data-URL prefix if the frontend sent one.
  let b64 = String(body.pdf);
  const comma = b64.indexOf('base64,');
  if (comma !== -1) b64 = b64.slice(comma + 7);

  // Size guard (base64 is ~1.37x the raw byte size).
  if (b64.length * 0.75 > MAX_PDF_BYTES) {
    return res.status(413).json({ success: false, error: 'That file is too large — please upload a statement under 10MB.' });
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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: EXTRACTION_PROMPT }
          ]
        }]
      })
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('[Statement] Anthropic error:', r.status, JSON.stringify(data).slice(0, 300));
      // 400 from the API usually means the PDF couldn't be read (e.g. scanned image).
      if (r.status === 400) {
        return res.status(422).json({
          success: false,
          error: "We couldn't read that statement. It may be a scanned image rather than a downloaded PDF — try downloading the PDF directly from your banking app."
        });
      }
      return res.status(502).json({ success: false, error: 'Could not process the statement right now. Please try again.' });
    }

    // Diagnostic: log the response shape so we can see stop_reason / content types.
    console.log('[Statement] API ok. stop_reason:', data.stop_reason,
      '| content types:', JSON.stringify((data.content || []).map(function (c) { return c.type; })),
      '| usage:', JSON.stringify(data.usage || {}));

    // Find the TEXT block — the model may return "thinking" blocks first, so we
    // can't just read content[0]. Concatenate all text blocks to be safe.
    let txt = '';
    if (Array.isArray(data.content)) {
      txt = data.content
        .filter(function (c) { return c && c.type === 'text' && typeof c.text === 'string'; })
        .map(function (c) { return c.text; })
        .join('\n');
    }
    txt = txt.replace(/```json|```/g, '').trim();

    if (!txt) {
      console.error('[Statement] No text block in response. Types:', JSON.stringify((data.content || []).map(function (c) { return c.type; })));
      return res.status(502).json({ success: false, error: 'The statement could not be read. Please try again.' });
    }

    let bills;
    try {
      bills = JSON.parse(txt);
    } catch (e) {
      // The model sometimes wraps the array in a sentence ("Here are the bills:...").
      // Pull out the first [...] block and try again before giving up.
      const start = txt.indexOf('[');
      const end = txt.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          bills = JSON.parse(txt.slice(start, end + 1));
        } catch (e2) {
          console.error('[Statement] Parse fail after slice. Raw:', txt.slice(0, 400));
          return res.status(502).json({ success: false, error: 'Could not read the bills from that statement. Please try again.' });
        }
      } else {
        console.error('[Statement] Parse fail, no array found. Raw:', txt.slice(0, 400));
        return res.status(502).json({ success: false, error: 'Could not read the bills from that statement. Please try again.' });
      }
    }

    if (!Array.isArray(bills)) bills = [];

    // Validate and clean every row — never trust the model's shape blindly.
    const clean = bills
      .map(function (b) {
        const amt = Number(b.amt);
        return {
          prov: safeStr(b.prov, 60),
          cat: CATEGORIES.indexOf(b.cat) !== -1 ? b.cat : 'Other',
          amt: isFinite(amt) && amt > 0 ? Math.round(amt * 100) / 100 : null,
          freq: safeStr(b.freq, 20) || 'Monthly',
          due: projectNextDue(b.lastPaid),
          source: safeStr(b.source, 120)
        };
      })
      .filter(function (b) { return b.prov && b.amt !== null; });

    return res.status(200).json({ success: true, bills: clean });

  } catch (err) {
    console.error('[Statement] Error:', err.message);
    return res.status(502).json({ success: false, error: 'Could not process the statement right now. Please try again.' });
  }
};

function safeStr(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}

// Given the date a bill was last paid, project the next monthly occurrence.
// Real data → honest projection. Returns YYYY-MM-DD, or null if we can't tell.
function projectNextDue(lastPaid) {
  if (!lastPaid) return null;
  const d = new Date(lastPaid);
  if (isNaN(d.getTime())) return null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Step forward a month at a time from the last payment until we're in the future.
  // Cap the loop so a very old date can't spin forever.
  let guard = 0;
  while (d < today && guard < 36) {
    d.setUTCMonth(d.getUTCMonth() + 1);
    guard++;
  }
  if (d < today) return null; // couldn't bring it into the future within 3 years

  return d.toISOString().split('T')[0];
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}
