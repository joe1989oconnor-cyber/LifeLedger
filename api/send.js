// api/reminders/send.js
// Daily reminder job. Triggered by cron-job.org.
//
//   GET /api/reminders/send            header: x-cron-secret: <CRON_SECRET>
//   GET /api/reminders/send?dry=1      preview without sending
//   GET /api/reminders/send?email=x@y  run for one user only (testing)
//   GET /api/reminders/send?unsub=TOK  unsubscribe link target (no secret needed)
//
// Required Vercel env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, CRON_SECRET, APP_URL
// Optional:
//   REMINDER_FROM   (defaults to LifeLedger <reminders@lifeledger.uk>)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.APP_URL || 'https://lifeledger.uk';
const FROM = process.env.REMINDER_FROM || 'LifeLedger <reminders@lifeledger.uk>';

// How many days ahead we warn, per reminder type
const WINDOWS = {
  renewal: [28, 10, 2],   // insurance, fixed-term tariffs — time to shop around
  mot: [30, 7],           // can test up to a month early and keep the expiry date
  tax: [14, 3],           // road tax
  document: [14, 3],      // passports, certificates, warranties
  payment: [3]            // only for bills not on direct debit
};

// Bill categories treated as renewals rather than routine payments
const RENEWAL_CATS = ['Home Insurance', 'Car Insurance', 'Gas', 'Electricity'];

module.exports = async function handler(req, res) {
  // ── Unsubscribe (public — no secret) ────────────────────────────────────
  if (req.query.unsub) {
    return handleUnsubscribe(req.query.unsub, res);
  }

  // ── Everything else requires the cron secret ────────────────────────────
  const provided = req.headers['x-cron-secret'] || req.query.secret;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const dryRun = req.query.dry === '1';
  const onlyEmail = req.query.email || null;

  try {
    let path = '/rest/v1/profiles?select=id,name,email,reminders_enabled,digest_enabled,unsub_token';
    path += onlyEmail
      ? `&email=eq.${encodeURIComponent(onlyEmail)}`
      : '&reminders_enabled=eq.true';

    const profiles = await sb(path, 'GET');
    if (!Array.isArray(profiles)) {
      console.error('[Reminders] Bad profiles response:', JSON.stringify(profiles).slice(0, 300));
      return res.status(500).json({ error: 'Could not load profiles' });
    }

    const isMonday = new Date().getUTCDay() === 1;
    const summary = { checked: 0, alerts: 0, digests: 0, skipped: 0, errors: 0, preview: [] };

    for (const p of profiles) {
      if (!p.email) { summary.skipped++; continue; }
      summary.checked++;

      try {
        const items = await collectItems(p.id);

        // ── Urgent one-off alerts ───────────────────────────────────────
        const due = items.filter(it => it.windows.includes(it.days));

        for (const item of due) {
          const already = await alreadySent(p.id, item.type, item.key, item.days);
          if (already && !dryRun) continue;

          if (dryRun) {
            summary.preview.push({ email: p.email, item: item.label, days: item.days });
          } else {
            await sendEmail(p, alertSubject(item), alertBody(p, item));
            await logSent(p.id, item.type, item.key, item.days);
          }
          summary.alerts++;
        }

        // ── Weekly digest (Mondays) ─────────────────────────────────────
        if (isMonday && p.digest_enabled !== false) {
          const soon = items.filter(it => it.days >= 0 && it.days <= 30);
          if (soon.length) {
            if (dryRun) {
              summary.preview.push({ email: p.email, digest: soon.length + ' items' });
            } else {
              await sendEmail(p, `Your week ahead — ${soon.length} thing${soon.length > 1 ? 's' : ''} coming up`, digestBody(p, soon));
            }
            summary.digests++;
          }
        }
      } catch (err) {
        console.error('[Reminders] user', p.id, err.message);
        summary.errors++;
      }
    }

    return res.status(200).json({ success: true, dryRun, ...summary });

  } catch (err) {
    console.error('[Reminders] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Gather everything with a date attached ────────────────────────────────
async function collectItems(userId) {
  const items = [];

  const [bills, docs, vehicles] = await Promise.all([
    sb(`/rest/v1/bills?user_id=eq.${userId}&select=id,prov,cat,amt,due,dd`, 'GET'),
    sb(`/rest/v1/docs?user_id=eq.${userId}&select=id,name,expiry`, 'GET'),
    sb(`/rest/v1/vehicles?user_id=eq.${userId}&select=id,serial,name,warranty,notes_json`, 'GET')
  ]);

  (Array.isArray(bills) ? bills : []).forEach(b => {
    if (!b.due) return;
    const days = daysUntil(b.due);
    if (days === null) return;
    const isRenewal = RENEWAL_CATS.includes(b.cat);
    // Bills on direct debit don't need payment nudges — they pay themselves
    if (!isRenewal && (b.dd === 'yes' || b.dd === true)) return;

    items.push({
      type: isRenewal ? 'renewal' : 'payment',
      key: 'bill-' + b.id,
      label: `${b.prov || b.cat || 'Bill'}${b.amt ? ` — £${Number(b.amt).toFixed(2)}` : ''}`,
      detail: isRenewal
        ? 'Renewal date — worth comparing before it rolls over.'
        : 'Payment due.',
      date: b.due,
      days,
      windows: isRenewal ? WINDOWS.renewal : WINDOWS.payment
    });
  });

  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d.expiry) return;
    const days = daysUntil(d.expiry);
    if (days === null) return;
    items.push({
      type: 'document',
      key: 'doc-' + d.id,
      label: d.name || 'Document',
      detail: 'Expires soon — check whether it needs renewing.',
      date: d.expiry,
      days,
      windows: WINDOWS.document
    });
  });

  (Array.isArray(vehicles) ? vehicles : []).forEach(v => {
    let extra = {};
    try { extra = v.notes_json ? JSON.parse(v.notes_json) : {}; } catch (e) { extra = {}; }
    const reg = v.serial || v.name || 'Your vehicle';

    const add = (dateStr, type, label, detail) => {
      if (!dateStr) return;
      const days = daysUntil(dateStr);
      if (days === null) return;
      items.push({
        type,
        key: `veh-${v.id}-${type}`,
        label: `${reg} — ${label}`,
        detail,
        date: dateStr,
        days,
        windows: WINDOWS[type] || WINDOWS.document
      });
    };

    add(extra.mot, 'mot', 'MOT due',
      'You can test up to a month early and keep your current expiry date.');
    add(extra.tax, 'tax', 'Road tax due',
      'Renew before it lapses — driving untaxed risks a fine.');
    add(extra.insurance, 'renewal', 'Insurance renewal',
      'Quotes are usually cheapest around three to four weeks before renewal.');
  });

  return items;
}

// ── Email content ─────────────────────────────────────────────────────────
function alertSubject(item) {
  if (item.days <= 0) return `${item.label} — due today`;
  if (item.days === 1) return `${item.label} — due tomorrow`;
  return `${item.label} — ${item.days} days to go`;
}

function alertBody(profile, item) {
  const when = item.days <= 0 ? 'today'
    : item.days === 1 ? 'tomorrow'
    : `in ${item.days} days`;

  return wrap(profile, `
    <p style="margin:0 0 14px">Hi ${esc(firstName(profile))},</p>
    <p style="margin:0 0 18px">A quick heads-up — <strong>${esc(item.label)}</strong> is due ${when}
    (${fmtDate(item.date)}).</p>
    <div style="background:#f0fdfa;border-left:3px solid #0d9488;padding:12px 16px;margin:0 0 22px;border-radius:0 8px 8px 0">
      ${esc(item.detail)}
    </div>
    <p style="margin:0 0 24px">
      <a href="${APP_URL}" style="background:#0d9488;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;display:inline-block;font-weight:700">Open LifeLedger</a>
    </p>
  `);
}

function digestBody(profile, items) {
  const rows = items
    .sort((a, b) => a.days - b.days)
    .map(it => `
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid #e2e8f0">
          <div style="font-weight:600;color:#0f172a">${esc(it.label)}</div>
          <div style="font-size:13px;color:#64748b">${fmtDate(it.date)}</div>
        </td>
        <td style="padding:11px 0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;color:${it.days <= 7 ? '#dc2626' : '#64748b'};font-size:13px;font-weight:600">
          ${it.days <= 0 ? 'Due today' : it.days + ' day' + (it.days === 1 ? '' : 's')}
        </td>
      </tr>`).join('');

  return wrap(profile, `
    <p style="margin:0 0 14px">Hi ${esc(firstName(profile))},</p>
    <p style="margin:0 0 20px">Here's what's coming up over the next 30 days.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">${rows}</table>
    <p style="margin:0 0 24px">
      <a href="${APP_URL}" style="background:#0d9488;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;display:inline-block;font-weight:700">Open LifeLedger</a>
    </p>
  `);
}

function wrap(profile, inner) {
  const unsub = `${APP_URL}/api/reminders/send?unsub=${encodeURIComponent(profile.unsub_token || '')}`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc">
    <div style="max-width:560px;margin:0 auto;padding:28px 20px;font:400 15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334155">
      <div style="font-size:19px;font-weight:700;color:#0d9488;margin:0 0 24px">LifeLedger</div>
      ${inner}
      <div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;color:#94a3b8">
        You're getting this because reminders are switched on in LifeLedger.
        <a href="${APP_URL}" style="color:#94a3b8">Manage reminders</a> ·
        <a href="${unsub}" style="color:#94a3b8">Unsubscribe from all reminders</a>
      </div>
    </div>
  </body></html>`;
}

// ── Sending ───────────────────────────────────────────────────────────────
async function sendEmail(profile, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to: [profile.email], subject, html })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ── Dedupe log ────────────────────────────────────────────────────────────
async function alreadySent(userId, type, key, days) {
  const rows = await sb(
    `/rest/v1/reminder_log?user_id=eq.${userId}&item_type=eq.${type}&item_id=eq.${key}&window_days=eq.${days}&select=id&limit=1`,
    'GET'
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function logSent(userId, type, key, days) {
  await sb('/rest/v1/reminder_log', 'POST', {
    user_id: userId, item_type: type, item_id: key, window_days: days
  });
}

// ── Unsubscribe ───────────────────────────────────────────────────────────
async function handleUnsubscribe(token, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const updated = await sb(
      `/rest/v1/profiles?unsub_token=eq.${encodeURIComponent(token)}`,
      'PATCH',
      { reminders_enabled: false, digest_enabled: false }
    );
    const ok = Array.isArray(updated) && updated.length > 0;
    return res.status(200).send(unsubPage(ok));
  } catch (err) {
    console.error('[Reminders] unsub error:', err);
    return res.status(200).send(unsubPage(false));
  }
}

function unsubPage(ok) {
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reminders — LifeLedger</title></head>
  <body style="margin:0;background:#f8fafc;font:400 16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334155">
    <div style="max-width:520px;margin:0 auto;padding:64px 24px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:#0d9488;margin-bottom:28px">LifeLedger</div>
      <h1 style="font-size:24px;color:#0f172a;margin:0 0 12px">
        ${ok ? 'Reminders turned off' : "That link didn't work"}
      </h1>
      <p style="margin:0 0 28px">
        ${ok
          ? "You won't receive any more reminder emails. You can turn them back on any time in Settings."
          : 'The link may have expired. You can change reminder settings directly in the app.'}
      </p>
      <a href="${APP_URL}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:9px;display:inline-block;font-weight:700">Open LifeLedger</a>
    </div>
  </body></html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function sb(path, method, body) {
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
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

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((a - b) / 864e5);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function firstName(p) {
  return (p.name || p.email || 'there').split(/[\s@]/)[0];
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
