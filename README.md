# Pazo — Partner Platform

A referral and partner commission platform. Partners share a referral link, QR
code or code; when a traveller signs up and buys, the commission is tracked,
calculated and paid automatically.

The first integration is **The Travela**, an eSIM and data connectivity
platform. Pazo runs their entire partner programme: individual agents,
institutional partners, The Travela's own business dashboard, and Pazo's
internal admin console.

**Stack:** React (Vite) · Node.js + Express · MySQL 8 / MariaDB 10.4

---

## Quick start

You need Node 18+ and a MySQL 8 or MariaDB 10.4+ server running. The XAMPP
MySQL that ships on most Windows dev machines works as-is.

```bash
# 1. API
cd server
npm install
cp .env.example .env          # edit DB_USER / DB_PASSWORD if yours differ
npm run setup                 # creates the schema and seeds demo data
npm run dev                   # http://localhost:4000

# 2. Web app (second terminal)
cd web
npm install
npm run dev                   # http://localhost:5173
```

`npm run setup` prints the demo logins and The Travela's API key. The key is
stored only as a SHA-256 hash, so copy it when it appears.

### Demo logins

| Role         | Login                     | Password     | Lands on      |
| ------------ | ------------------------- | ------------ | ------------- |
| Individual   | `amina@demo.pazo.co.tz`   | `Demo2026!`  | `/app`        |
| Organisation | `serena@demo.pazo.co.tz`  | `Demo2026!`  | `/institution`|
| Business     | `demo@thetravela.com`     | `Demo2026!`  | `/business`   |
| Pazo admin   | `admin@pazo.co.tz`        | `Admin2026!` | `/admin`      |
| Pazo ops     | `ops@pazo.co.tz`          | `Admin2026!` | `/admin`      |

The individual account also signs in by phone: `0754 892 001`.

There is one login page for everyone. The server detects the role and routes
each person to the right dashboard, so nobody has to pick the correct door.

---

## What is in the box

### Four dashboards, one application

**Individual partner** — mobile-first. Wallet balance and instant withdrawal to
mobile money, referral code with QR and share sheet, commission history,
notifications, profile with OTP-verified phone and payout changes.

**Organisation partner** — the same shape, with monthly payouts instead of
instant withdrawal: accumulated balance, next payout date, per-month payout
table and a printable statement for every month.

**Business (The Travela)** — desktop-first console. Programme overview with
30-day sales chart, partner table with a detail panel, anonymised referral
activity, full commission history, wallet with top-up instructions and pending
commission handling, settings covering commission rate, API key and team access.

**Pazo admin** — the internal control plane. Platform overview, business
management with wallet top-ups and API key rotation, partner management across
every business, the organisation approval queue, a transaction monitor,
monthly payout processing, bulk communications, account management, a CMS for
the public site, platform configuration and full audit and API logs.

### The commission engine

Everything turns on `server/src/services/commissions.js`. When The Travela
reports a confirmed payment:

1. The referral for that traveller is looked up.
2. Commission is the purchase amount times the partner's rate, or the business
   default; the platform fee is calculated the same way.
3. The business wallet row is locked with `SELECT ... FOR UPDATE`, so two
   concurrent webhooks can never overdraw the balance.
4. If the wallet covers it: debit the wallet, credit the partner, write the
   ledger entry, mark the transaction paid and notify the partner.
5. If it does not: store the transaction as `pending` and alert the business and
   Pazo admins. A later wallet top-up settles it automatically.

The whole thing runs in one MySQL transaction. Repeating a webhook with the same
`transaction_reference` returns the original result and never pays twice.

---

## Integration — for The Travela's developer

Two endpoints, authenticated with the business API key.

```
Authorization: Bearer pazo_live_xxxxxxxxxxxx
Base URL:      http://localhost:4000/api/v1
```

Live documentation: `GET /api/v1/integrations/docs`.
Test your key: `GET /api/v1/integrations/verify`.

### 1. Register a referral — when a traveller signs up

```http
POST /api/v1/integrations/referrals/register
{ "referral_code": "AMINA07", "tourist_id": "tvl_8842" }
```

```jsonc
// 200 — linked
{ "success": true, "data": { "partner_id": "…", "partner_name": "Amina Hassan", "commission_rate": 0.08 } }
// 200 — already linked (first code wins, never reassigned)
{ "success": true, "data": { "message": "Tourist already linked — referral unchanged" } }
// 404 — bad code
{ "success": false, "error": "Referral code not found or inactive" }
```

### 2. Report a payment — after every confirmed card payment

```http
POST /api/v1/integrations/transactions
{
  "tourist_id": "tvl_8842",
  "amount_tzs": 30840,
  "bundle_type": "Tanzania 7-Day 5GB",
  "transaction_type": "first_purchase",   // or "topup"
  "transaction_reference": "TVL-90210"
}
```

```jsonc
// paid
{ "success": true, "data": { "commission_tzs": 2467, "platform_fee_tzs": 308, "commission_status": "paid" } }
// wallet short — Pazo pays it automatically after a top-up
{ "success": true, "data": { "commission_tzs": 2467, "commission_status": "pending", "reason": "insufficient_wallet_balance" } }
// traveller has no referral — nothing owed
{ "success": true, "data": { "commission_tzs": 0, "message": "No referral linked to this tourist" } }
```

**Rules that matter**

- Amounts are always integer Tanzanian shillings. `30840`, never `30840.50`.
- `transaction_reference` must be unique per business. Repeats are safe.
- Retry on 5xx up to three times, backing off 5s, 15s then 45s.
- Every call is logged and visible to Pazo admins under Logs.

### Short referral links

`GET /r/:code` records the click and redirects to the business signup URL, which
is what gives partners their click and conversion numbers.

---

## Privacy

The platform stores **no traveller personal data at all**. Only the opaque
`tourist_id` supplied by the business is kept. No names, emails, phone numbers
or payment details.

Partners see the commission amount, the bundle and the date. The business
dashboard adds the anonymised customer ID for its own reconciliation. This is
enforced in the queries themselves, not only in the interface.

---

## Project layout

```
server/
  migrations/001_init.sql      Schema: 23 tables
  scripts/migrate.js           Creates the database, applies migrations
  scripts/seed.js              Three months of realistic demo data
  src/
    config/env.js              Environment, with safe defaults
    db/pool.js                 Connection pool, query helpers, transactions
    middleware/                Auth, role guards, error handling
    routes/                    auth, individual, institution, business,
                               admin, integrations, public
    services/
      commissions.js           The commission engine
      notifications.js         Notification copy and delivery
      otp.js                   One-time codes
      settings.js              Platform configuration, cached
      statements.js            Printable monthly statements
      qr.js                    Server-side QR generation
      audit.js                 Audit trail
    jobs/scheduler.js          Hourly cleanup and payout reminders

web/
  src/
    app/                       Router, auth context, toasts, error boundary
    components/                Icons, logo, UI primitives, charts, shells
    hooks/useApi.js            Fetching, debounce, media queries, forms
    lib/                       API client, formatting
    pages/                     Public, individual, institution, business, admin
    styles/                    Tokens, base, components, layout, public
```

---

## Responsive behaviour

Everything works from a 320px phone to a wide desktop.

- **Partner dashboards** are mobile-first with a bottom tab bar, and promote to
  a sidebar layout above 900px.
- **Business and admin consoles** are desktop-first; the sidebar becomes an
  off-canvas drawer below 1024px.
- **Dense tables** turn into labelled cards below 900px rather than scrolling
  sideways.
- **Modals** become bottom sheets on phones, within thumb reach.
- Inputs use 16px type on small screens so iOS Safari does not zoom on focus.
- Safe-area insets are respected for phones with a home indicator.

---

## Security

| Area           | Implementation                                                     |
| -------------- | ------------------------------------------------------------------ |
| Passwords      | bcrypt, cost factor 12                                             |
| Sessions       | Short-lived JWT access token plus a rotating refresh token         |
| API keys       | SHA-256 hashed; the plaintext is shown once and never again        |
| OTP            | Cryptographically random, hashed, expiring, attempt-limited        |
| Lockout        | Five failed logins locks the account for thirty minutes            |
| SQL            | Parameterised everywhere; no string concatenation                  |
| Rate limiting  | Per-minute budgets on auth, public and integration endpoints       |
| Audit          | Every privileged action logged with actor, target, time and IP     |
| Money          | Integer shillings only, with row locks on every balance change     |
| Webhooks       | HMAC-SHA256 checksum verified in constant time, replay-proof       |
| Payouts        | Queued and serialised, daily cap, one in flight per partner        |

---

## Configuration

`server/.env` — see `.env.example` for the full list.

Before deploying anywhere real:

- Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to long random values.
- Set `OTP_DEV_ECHO=false`. In development the API returns the OTP in the
  response so the flow works without an SMS gateway; in production that would
  hand anyone a login.
- Set `NODE_ENV=production` and point `APP_URL` at the deployed web app.

Most operational settings are **not** environment variables. Minimum withdrawal,
OTP expiry, session length, commission defaults, the payout day and maintenance
mode all live in the database and are edited from Admin → Configuration.

### Connecting SMS, email and WhatsApp

`deliverExternal` in `server/src/services/notifications.js` is the single
integration point. It currently logs what it would send and records the intent,
so the admin send-history stays truthful. Replace that one function with a
gateway call and every notification path starts delivering.

### ClickPesa payment gateway

Money moves through ClickPesa in both directions.

**Collections — funding a business wallet.** The business enters an amount and a
mobile money number under Wallet → Top up. A prompt is pushed to that handset.
The wallet is credited only when ClickPesa confirms by webhook, never when the
request is made, and any commissions that were waiting on funds pay out
immediately afterwards. Bank transfer stays available for larger amounts and is
credited by the Pazo finance team.

**Payouts — paying an agent.** A partner requests a withdrawal. Their balance is
debited at once and the row is queued. A worker sends one payout per minute,
because ClickPesa rate limits payout creation to one per merchant per 60
seconds. The provider's callback marks it complete, or fails it and refunds the
partner automatically.

Set these in `server/.env`:

```
CLICKPESA_CLIENT_ID=…
CLICKPESA_API_KEY=…
CLICKPESA_CHECKSUM_KEY=…      # enable checksums in the ClickPesa portal
CLICKPESA_WEBHOOK_IPS=…       # optional source-IP allowlist
```

Point the ClickPesa portal's webhook URL at:

```
https://your-api-host/api/v1/webhooks/clickpesa
```

**Your ClickPesa account must have disbursement (payout) enabled**, not only
collections. Collection-only is the common default and agent payments are the
whole point here.

Without credentials the platform still works: withdrawals are accepted, debited
and queued, and they send as soon as the keys are in place. Nothing is lost.

Admin → Payouts → Agent withdrawals shows the queue depth, the live float at
ClickPesa, and every callback received with whether its signature verified.

---

## Build for production

```bash
cd web && npm run build     # static files in web/dist
cd server && npm start      # serve dist behind nginx or any static host
```

Point the web app at the deployed API with `VITE_API_URL` at build time.
