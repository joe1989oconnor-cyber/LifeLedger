// api/bank/index.js
// Merged TrueLayer endpoint — replaces accounts.js and transactions.js
// so we stay under Vercel's 12-function Hobby limit.
//
//   GET /api/bank?type=accounts
//   GET /api/bank?type=transactions&account_id=xxx
//
// All TrueLayer calls happen server-side; the access token lives in an
// httpOnly cookie and is never exposed to the browser.

const TRUELAYER_API = 'https://api.truelayer.com';

// Merchant name patterns → LifeLedger bill categories
const BILL_PATTERNS = [
  // Energy
  { pattern: /british gas|britishgas/i, cat: 'Gas', prov: 'British Gas', emoji: '🔥' },
  { pattern: /octopus energy|octopusenergy/i, cat: 'Gas', prov: 'Octopus Energy', emoji: '⚡' },
  { pattern: /e\.?on|eon next/i, cat: 'Electricity', prov: 'E.ON', emoji: '⚡' },
  { pattern: /edf energy|edf/i, cat: 'Electricity', prov: 'EDF Energy', emoji: '⚡' },
  { pattern: /scottish power|scottishpower/i, cat: 'Gas', prov: 'Scottish Power', emoji: '⚡' },
  { pattern: /npower|n power/i, cat: 'Electricity', prov: 'Npower', emoji: '⚡' },
  { pattern: /ovo energy|ovo/i, cat: 'Gas', prov: 'OVO Energy', emoji: '⚡' },
  { pattern: /bulb energy|bulb/i, cat: 'Electricity', prov: 'Bulb', emoji: '⚡' },
  { pattern: /shell energy/i, cat: 'Gas', prov: 'Shell Energy', emoji: '⚡' },
  { pattern: /utilita/i, cat: 'Electricity', prov: 'Utilita', emoji: '⚡' },
  // Water
  { pattern: /thames water/i, cat: 'Water', prov: 'Thames Water', emoji: '💧' },
  { pattern: /anglian water/i, cat: 'Water', prov: 'Anglian Water', emoji: '💧' },
  { pattern: /severn trent/i, cat: 'Water', prov: 'Severn Trent', emoji: '💧' },
  { pattern: /united utilities/i, cat: 'Water', prov: 'United Utilities', emoji: '💧' },
  { pattern: /yorkshire water/i, cat: 'Water', prov: 'Yorkshire Water', emoji: '💧' },
  { pattern: /southern water/i, cat: 'Water', prov: 'Southern Water', emoji: '💧' },
  { pattern: /wessex water/i, cat: 'Water', prov: 'Wessex Water', emoji: '💧' },
  { pattern: /affinity water/i, cat: 'Water', prov: 'Affinity Water', emoji: '💧' },
  // Broadband / Phone
  { pattern: /bt group|bt broadband|bt\.com/i, cat: 'Internet & Broadband', prov: 'BT', emoji: '📡' },
  { pattern: /virgin media|virginmedia/i, cat: 'Internet & Broadband', prov: 'Virgin Media', emoji: '📡' },
  { pattern: /sky broadband|sky\.com/i, cat: 'Internet & Broadband', prov: 'Sky', emoji: '📡' },
  { pattern: /talk ?talk/i, cat: 'Internet & Broadband', prov: 'TalkTalk', emoji: '📡' },
  { pattern: /vodafone/i, cat: 'Internet & Broadband', prov: 'Vodafone', emoji: '📡' },
  { pattern: /ee limited|ee\.co\.uk/i, cat: 'Internet & Broadband', prov: 'EE', emoji: '📡' },
  { pattern: /three\.co\.uk|three mobile/i, cat: 'Internet & Broadband', prov: 'Three', emoji: '📡' },
  { pattern: /o2 uk|o2\.co\.uk/i, cat: 'Internet & Broadband', prov: 'O2', emoji: '📡' },
  { pattern: /community fibre/i, cat: 'Internet & Broadband', prov: 'Community Fibre', emoji: '📡' },
  { pattern: /hyperoptic/i, cat: 'Internet & Broadband', prov: 'Hyperoptic', emoji: '📡' },
  // TV / Streaming
  { pattern: /netflix/i, cat: 'TV & Streaming', prov: 'Netflix', emoji: '📺' },
  { pattern: /spotify/i, cat: 'TV & Streaming', prov: 'Spotify', emoji: '🎵' },
  { pattern: /amazon prime|amazon\.co\.uk/i, cat: 'TV & Streaming', prov: 'Amazon Prime', emoji: '📦' },
  { pattern: /disney\+|disney plus/i, cat: 'TV & Streaming', prov: 'Disney+', emoji: '🎬' },
  { pattern: /apple\.com\/bill|apple music/i, cat: 'TV & Streaming', prov: 'Apple', emoji: '🍎' },
  { pattern: /now tv|now\.tv/i, cat: 'TV & Streaming', prov: 'Now TV', emoji: '📺' },
  { pattern: /sky tv|sky sports|sky cinema/i, cat: 'TV & Streaming', prov: 'Sky TV', emoji: '📺' },
  { pattern: /youtube premium/i, cat: 'TV & Streaming', prov: 'YouTube Premium', emoji: '▶️' },
  // Council Tax
  { pattern: /council tax|council\.gov\.uk/i, cat: 'Council Tax', prov: 'Council Tax', emoji: '🏛️' },
  { pattern: /derby city council|derby cc/i, cat: 'Council Tax', prov: 'Derby City Council', emoji: '🏛️' },
  { pattern: /birmingham city council/i, cat: 'Council Tax', prov: 'Birmingham City Council', emoji: '🏛️' },
  { pattern: /manchester city council/i, cat: 'Council Tax', prov: 'Manchester City Council', emoji: '🏛️' },
  // Insurance
  { pattern: /aviva/i, cat: 'Home Insurance', prov: 'Aviva', emoji: '🏠' },
  { pattern: /direct line/i, cat: 'Home Insurance', prov: 'Direct Line', emoji: '🏠' },
  { pattern: /axa insurance/i, cat: 'Home Insurance', prov: 'AXA', emoji: '🏠' },
  { pattern: /admiral/i, cat: 'Car Insurance', prov: 'Admiral', emoji: '🚗' },
  { pattern: /churchill/i, cat: 'Car Insurance', prov: 'Churchill', emoji: '🚗' },
  { pattern: /lv= insurance|lv insurance/i, cat: 'Home Insurance', prov: 'LV=', emoji: '🏠' },
  // Mortgage / Rent
  { pattern: /nationwide bs|nationwide building/i, cat: 'Mortgage / Rent', prov: 'Nationwide', emoji: '🏡' },
  { pattern: /halifax mortgage|halifax plc/i, cat: 'Mortgage / Rent', prov: 'Halifax', emoji: '🏡' },
  { pattern: /lloyds mortgage/i, cat: 'Mortgage / Rent', prov: 'Lloyds', emoji: '🏡' },
  { pattern: /barclays mortgage/i, cat: 'Mortgage / Rent', prov: 'Barclays', emoji: '🏡' },
  { pattern: /rent payment|rent transfer|landlord/i, cat: 'Mortgage / Rent', prov: 'Rent', emoji: '🏡' }
];

const RECURRING_TYPES = ['DIRECT_DEBIT', 'STANDING_ORDER'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(req));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = getTokenFromCookie(req);
  if (!token) {
    return res.status(401).json({
      error: 'not_connected',
      message: 'No bank connection found — please connect your bank first'
    });
  }

  const type = (req.query.type || 'accounts').toLowerCase();

  try {
    if (type === 'accounts') return await getAccounts(req, res, token);
    if (type === 'transactions') return await getTransactions(req, res, token);
    return res.status(400).json({ error: 'Invalid type. Use "accounts" or "transactions".' });
  } catch (err) {
    console.error('[Bank] Error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

// ── Accounts ──────────────────────────────────────────────────────────────
async function getAccounts(req, res, token) {
  const response = await fetch(`${TRUELAYER_API}/data/v1/accounts`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json; charset=UTF-8' }
  });

  if (response.status === 401) return expired(res);

  if (!response.ok) {
    console.error('[Bank] accounts error:', response.status, await response.text());
    return res.status(502).json({ error: 'upstream_error', message: 'Could not fetch accounts from your bank' });
  }

  const data = await response.json();
  const accounts = (data.results || []).map(a => ({
    account_id: a.account_id,
    account_type: a.account_type,
    display_name: a.display_name,
    currency: a.currency,
    provider: {
      display_name: a.provider?.display_name || 'Your bank',
      logo_uri: a.provider?.logo_uri || null
    }
  }));

  return res.status(200).json({ accounts });
}

// ── Transactions + bill detection ─────────────────────────────────────────
async function getTransactions(req, res, token) {
  const { account_id } = req.query;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const from = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0];
  const to = new Date().toISOString().split('T')[0];

  const response = await fetch(
    `${TRUELAYER_API}/data/v1/accounts/${account_id}/transactions?from=${from}&to=${to}`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json; charset=UTF-8' } }
  );

  if (response.status === 401) return expired(res);

  if (!response.ok) {
    console.error('[Bank] transactions error:', response.status, await response.text());
    return res.status(502).json({ error: 'upstream_error' });
  }

  const data = await response.json();
  const transactions = data.results || [];

  const allTxns = transactions.map(txn => {
    const desc = (txn.description || txn.merchant_name || '').trim();
    const amount = Math.abs(txn.amount);
    const isOutgoing = txn.amount < 0;
    const ttype = txn.transaction_type || txn.transaction_classification?.[0] || '';
    const isRecurring = RECURRING_TYPES.includes(ttype) || txn.transaction_category === 'BILL_PAYMENT';

    let billMatch = null;
    if (isOutgoing) {
      for (const p of BILL_PATTERNS) {
        if (p.pattern.test(desc)) {
          billMatch = { prov: p.prov, cat: p.cat, amt: amount, freq: 'Monthly', emoji: p.emoji };
          break;
        }
      }
    }

    return {
      id: txn.transaction_id,
      date: txn.timestamp?.split('T')[0] || txn.date,
      desc,
      amount: txn.amount,
      type: ttype,
      recurring: isRecurring || !!billMatch,
      billMatch,
      emoji: billMatch?.emoji || (isOutgoing ? '💸' : '💰'),
      currency: txn.currency || 'GBP'
    };
  });

  // Unmatched direct debits appearing 2+ times are probably bills too
  const groups = {};
  allTxns.filter(t => t.recurring && !t.billMatch && t.amount < 0).forEach(t => {
    const key = t.desc.toLowerCase().replace(/\s+/g, ' ').trim();
    (groups[key] = groups[key] || []).push(t);
  });

  Object.values(groups).forEach(txns => {
    if (txns.length >= 2) {
      const avg = txns.reduce((a, t) => a + Math.abs(t.amount), 0) / txns.length;
      txns.forEach(t => {
        if (!t.billMatch) {
          t.billMatch = {
            prov: toTitleCase(t.desc),
            cat: 'Other',
            amt: parseFloat(avg.toFixed(2)),
            freq: 'Monthly',
            emoji: '📋'
          };
        }
      });
    }
  });

  // One suggestion per provider — keep the most recent
  const billsMap = {};
  allTxns.forEach(t => {
    if (!t.billMatch) return;
    const key = t.billMatch.prov.toLowerCase();
    if (!billsMap[key] || t.date > billsMap[key].date) billsMap[key] = t;
  });

  const suggestedBills = Object.values(billsMap)
    .sort((a, b) => (a.billMatch.cat || '').localeCompare(b.billMatch.cat || ''));

  return res.status(200).json({
    transactions: allTxns.slice(0, 50),
    suggestedBills,
    totalTransactions: allTxns.length,
    period: { from, to }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function expired(res) {
  res.setHeader('Set-Cookie', [
    'tl_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    'tl_connected=; Secure; SameSite=Lax; Path=/; Max-Age=0'
  ]);
  return res.status(401).json({
    error: 'token_expired',
    message: 'Bank connection has expired — please reconnect your bank'
  });
}

function getTokenFromCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), v.join('=')];
    })
  );
  const encoded = cookies['tl_token'];
  if (!encoded) return null;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (decoded.expires_at && decoded.expires_at < Date.now()) return null;
    return decoded.access_token;
  } catch {
    return null;
  }
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return origin === allowed ? origin : allowed;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()).slice(0, 40);
}
