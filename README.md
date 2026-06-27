# LifeLedger — TrueLayer Integration Deployment Guide

## Project Structure

```
lifeledger/
├── api/
│   ├── auth/
│   │   ├── truelayer.js   ← Initiates OAuth (redirects to TrueLayer)
│   │   ├── callback.js    ← Handles OAuth callback, exchanges code for tokens
│   │   └── refresh.js     ← Token refresh (stub until Supabase added)
│   └── bank/
│       ├── accounts.js    ← Fetches user's bank accounts
│       └── transactions.js ← Fetches & categorises transactions
├── public/
│   └── index.html         ← The LifeLedger single-page app
├── vercel.json            ← Vercel routing config
└── README.md
```

## Environment Variables (already set in Vercel)

| Variable | Description |
|---|---|
| `TRUELAYER_CLIENT_ID` | Your TrueLayer application client ID |
| `TRUELAYER_CLIENT_SECRET` | Your TrueLayer application client secret (**server-side only**) |

### Optional but recommended

| Variable | Description |
|---|---|
| `APP_URL` | Your production URL e.g. `https://lifeledger.app` |

If `APP_URL` is not set, the app uses `VERCEL_URL` (auto-set by Vercel on each deployment).

---

## TrueLayer Console Setup

Before deploying, you need to configure the redirect URI in your TrueLayer console:

1. Go to [console.truelayer.com](https://console.truelayer.com)
2. Select your application
3. Go to **Redirect URIs**
4. Add: `https://YOUR-VERCEL-URL/api/auth/callback`
   - Also add `https://lifeledger.app/api/auth/callback` if using a custom domain
   - For local dev add: `http://localhost:3000/api/auth/callback`

---

## How the OAuth Flow Works

```
User clicks "Connect your bank"
        ↓
Frontend → GET /api/auth/truelayer
        ↓
Server generates signed state (CSRF protection)
        ↓
Server redirects → TrueLayer Auth UI
        ↓
User selects bank & logs in on their bank's page
        ↓
TrueLayer redirects → /api/auth/callback?code=xxx&state=xxx
        ↓
Server verifies state signature
        ↓
Server exchanges code for access_token + refresh_token
(TRUELAYER_CLIENT_SECRET used here — never exposed to browser)
        ↓
Server sets httpOnly cookie with access_token
        ↓
Server redirects → /?bank_callback=1&success=true
        ↓
Frontend detects callback params, fetches accounts & transactions
via /api/bank/accounts and /api/bank/transactions
(token sent automatically via httpOnly cookie)
        ↓
Bill detection runs, user reviews and imports bills
```

---

## Security Notes

- `TRUELAYER_CLIENT_SECRET` is **only used in `api/auth/callback.js`** — never sent to the browser
- Access tokens are stored in **httpOnly cookies** — not accessible via JavaScript
- State parameter is **HMAC-signed** to prevent CSRF attacks
- All API routes use **credentials: 'include'** to send cookies cross-origin
- TrueLayer access is **read-only** (no payment initiation scopes requested)

---

## Adding Supabase (Next Step)

Currently, refresh tokens are not persisted (users need to reconnect when the access token expires, typically after 1 hour). Once Supabase is added:

1. On OAuth callback, store `refresh_token` in Supabase against the user's `user_id`
2. Update `api/auth/refresh.js` to look up the refresh token from Supabase and exchange it
3. Frontend automatically calls `/api/auth/refresh` when it receives a 401

---

## Deploying to Vercel

```bash
# Option 1: Vercel CLI
npm i -g vercel
cd lifeledger/
vercel --prod

# Option 2: Drag & drop
# Zip the lifeledger/ folder and drag to vercel.com/new
```

The app will be live at your Vercel URL. Point your custom domain in Vercel dashboard settings.

---

## Local Development

```bash
npm i -g vercel
cd lifeledger/
vercel dev
# App runs at http://localhost:3000
# API routes run at http://localhost:3000/api/...
```

Make sure to add `http://localhost:3000/api/auth/callback` as a redirect URI in your TrueLayer console for local testing.
