# Pazo — Build Handoff

What was built, what was verified, and what to do before this goes live.

---

## Against the specification

Both source documents were implemented in full, with the stack changed to React
and MySQL as instructed.

| PRD section | Built |
| --- | --- |
| 2. Individual dashboard | Signup (3 steps with live code check and phone OTP), login, home, wallet with withdrawal, my code with QR, profile with OTP-verified changes, notifications |
| 3. Institution dashboard | Application flow, home, earnings, monthly payouts with printable statements, code, profile with payout-change request |
| 4. Business dashboard | Overview with 30-day chart, partners with detail panel, anonymised referral activity, commission history, wallet with top-up and pending settlement, settings with API key and team |
| 5. Admin dashboard | Overview, businesses, partners, approval queue, transaction monitor, monthly payouts, communications, accounts, CMS, configuration, audit and API logs |
| 6. API specification | Every endpoint, `{ success, data, error }` envelope, integer TZS, pagination, the documented status codes |
| 7. Database schema | All specified tables, translated to MySQL, plus the tables the PRD implies |
| 8. Non-functional | HTTPS-ready, bcrypt cost 12, hashed API keys and OTPs, rate limits, audit logging, parameterised SQL, no traveller PII |

### Added beyond the specification

These were needed for the platform to actually run, and are noted so nothing
looks unexplained:

- **Referral click tracking** (`/r/:code`) — the PRD reports click counts and
  conversion rates, which requires something to record clicks.
- **Wallet ledger** — a running-balance audit trail behind the wallet screen.
- **Institution applications table** — the approval queue needs somewhere to
  hold an application before an account exists.
- **Refresh tokens, OTP codes, audit log, API request log** — required by the
  security section.
- **CMS, announcements, message templates, platform settings** — required by the
  admin screens for content, comms and configuration.
- **Business team members** — the settings screen specifies team access.
- **Automatic pending settlement** — a wallet top-up immediately pays whatever
  was waiting on funds, instead of leaving partners to chase it.

---

## What was verified

Not asserted — actually run against the live stack.

**Commission engine.** A real webhook on a TZS 30,840 bundle produced TZS 2,467
commission and TZS 308 platform fee at 8% and 1%. Replaying the same
`transaction_reference` returned the original result and paid nothing further.
An unknown traveller returned commission 0. An invalid API key returned 401.

**Money movement.** A withdrawal debited the partner wallet correctly and
appeared as processing. Amounts below the minimum and above the balance were
both rejected with the right message. A wallet top-up of TZS 500,000
automatically settled 5 pending commissions worth TZS 18,297.

**Signup.** Code availability check, OTP issue, OTP verification, account
creation with generated link, and rejection of a consumed code.

**Admin writes.** Institution approval created the account and credentials.
Settings and CMS updates persisted and took effect immediately — the changed
minimum withdrawal was enforced on the very next withdrawal attempt.

**Coverage.** 41 endpoints across four roles returned 200. Four cross-role
attempts were correctly refused: individual and business to admin gave 403, no
token gave 401, institution to individual gave 403.

**Interface.** 37 screens captured in Chrome at 390px, 820px and 1440px with
zero console errors.

---

## Before going live

**Must do:**

1. Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to long random values.
2. Set `OTP_DEV_ECHO=false`. In development the API returns the one-time code in
   its response so the flow works without an SMS gateway. Leaving that on in
   production hands anyone a login.
3. Set `NODE_ENV=production` and point `APP_URL` at the real web app.
4. Change every demo password, or remove the demo accounts.
5. Terminate TLS in front of the API and enforce HSTS.
6. Regenerate The Travela's API key and send it through a secure channel.

**Should do:**

7. Connect a real SMS and email gateway by replacing `deliverExternal` in
   `server/src/services/notifications.js`. It is the only integration point.
8. Get ClickPesa credentials and confirm the account has **disbursement**
   enabled, not only collections. Set the client id, API key and checksum key,
   and point the portal's webhook at `/api/v1/webhooks/clickpesa`.
9. Set up database backups. Transaction records are a permanent financial audit
   trail and are never deleted.
10. If the API ever runs on more than one node, move `jobs/scheduler.js` to a
    single worker so a job cannot run twice.

---

## Notes for whoever picks this up

**Money is always an integer.** Every amount is whole Tanzanian shillings, in
`BIGINT` columns. Nothing anywhere is a float. Keep it that way.

**Balances are locked, not read-then-written.** The commission engine and the
withdrawal path both take `SELECT ... FOR UPDATE` on the balance row inside a
transaction. Two concurrent webhooks cannot overdraw a wallet. Any new code that
moves money needs the same discipline.

**Idempotency is load-bearing.** The Travela is told to retry on 5xx. The unique
constraint on `(business_id, external_tx_ref)` plus the duplicate check is what
stops a retry paying twice.

**Historic rates are frozen.** `commission_rate_applied` is stored on each
transaction, so changing a rate never rewrites past statements.

**Privacy is enforced in the queries.** Partner-facing endpoints never select
traveller identity, because Pazo never stores it. Only the opaque `tourist_id`
exists. Do not add a column for a traveller name.

**Configuration lives in the database, not the environment.** Withdrawal
minimums, OTP expiry, session length and the payout day are edited from Admin →
Configuration and take effect within about fifteen seconds, without a deploy.

---

## Known limitations

These are deliberate and match the specification's "not in this version" list.

- **SMS, email and WhatsApp are stubbed.** Messages are logged and recorded so
  the admin send history is honest, but nothing is delivered until a gateway is
  connected.
- **ClickPesa is wired but needs live credentials.** The integration is
  complete and verified against a mock of the documented API. Until real keys
  are set, withdrawals queue safely instead of sending.
- **Statements are print-ready HTML, not server-generated PDF.** The browser's
  own print-to-PDF produces the file. This keeps the server dependency-free and
  gives sharper output than a server-side rasteriser.
- **English only.** Swahili is listed as a future version.
- **Business subscription billing is not built.** Free access in this version.
