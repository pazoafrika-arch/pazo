# Payments — ClickPesa

How money enters and leaves the platform, and the rules that keep it correct.

---

## The two flows

**In.** The Travela funds its Pazo wallet. Commissions are paid out of that
balance as transactions arrive.

**Out.** Individual agents withdraw their earnings to mobile money.

Institutions are different: their monthly balance is disbursed by the Pazo team
from Admin → Payouts, which suits a small number of large, scheduled transfers.

---

## Setting it up

1. In the ClickPesa developer portal, create an application and copy the client
   id and API key.
2. Enable checksums and copy the checksum key.
3. Set the webhook URL to `https://your-api-host/api/v1/webhooks/clickpesa` and
   subscribe to: PAYMENT RECEIVED, PAYMENT FAILED, PAYOUT INITIATED,
   PAYOUT REFUNDED, PAYOUT REVERSED.
4. Fill in `server/.env`:

```
CLICKPESA_BASE_URL=https://api.clickpesa.com/third-parties
CLICKPESA_CLIENT_ID=...
CLICKPESA_API_KEY=...
CLICKPESA_CHECKSUM_KEY=...
CLICKPESA_WEBHOOK_IPS=          # optional, comma separated
```

5. Restart the API and check Admin → Payouts → Agent withdrawals. It shows
   whether the gateway is configured and the live float at ClickPesa.

**Confirm your account has disbursement enabled.** Collection-only is the usual
default, and paying agents is the point of this integration. Without it,
collections will work and every payout will fail.

---

## Collections: funding the wallet

The business opens Wallet → Top up, enters an amount and a mobile money number.
Pazo calls `POST /payments/initiate-ussd-push-request`, which pushes a prompt to
that handset.

The wallet is credited **only** when ClickPesa confirms by webhook. Nothing is
credited when the request is made, so an abandoned prompt costs nothing. The
moment the credit lands, any commissions that were stuck as `pending` for want
of funds are settled automatically.

A top-up that is never approved is polled for up to an hour, then marked
expired.

Bank transfer remains available for larger amounts. It appears with the transfer
details and a payment reference, and a Pazo admin credits the wallet once the
funds clear.

---

## Payouts: paying an agent

1. The partner requests a withdrawal. Their balance is debited immediately and
   the row is written as `queued`.
2. A worker sends one payout every 70 seconds, oldest first.
3. ClickPesa's callback marks it `completed`, or fails it.
4. A failure returns the money to the partner's wallet and notifies them.

The partner never sees `queued`. It is reported as `processing`, because from
their side it is simply on its way.

### Why a queue rather than sending immediately

ClickPesa limits payout creation to **one per merchant every 60 seconds**.
Sending inline would mean the second agent to press withdraw in a busy minute
gets an error. Queueing means the request is always accepted, the balance is
always correct, and the money leaves as soon as the provider allows.

### Preview

Before confirming, the partner sees the fee and the account name the mobile
operator holds for that number. Money does not leave on a mistyped number.

---

## The rules that keep it correct

**Nothing is credited on an unverified word.** A collection credits the wallet
only after the provider confirms. A payout completes only on a signed callback
or a direct status read from the gateway.

**Every webhook is verified.** The HMAC-SHA256 checksum is recomputed over the
canonicalised payload and compared in constant time. A bad checksum is rejected
with 401 and still recorded, so forgery attempts are visible in the admin
callback log.

**When checksums are not configured, callbacks are treated as hints.** The
platform re-reads the authoritative state from the gateway before moving money,
rather than trusting an unsigned body.

**Replays cannot double-apply.** Every event is stored with a unique dedupe key
before it is processed. A second delivery is acknowledged and ignored. On top of
that, the credit itself is guarded by a `credited` flag checked under a row
lock.

**Retries cannot double-pay.** The `orderReference` is generated once and reused
across retries. If the provider already accepted it, the retry returns 409 and
Pazo reconciles instead of paying again.

**Balances are locked, never read-then-written.** Every credit and debit takes
`SELECT ... FOR UPDATE` inside a transaction.

**One withdrawal in flight per partner.** Two simultaneous requests against the
same balance would otherwise both pass the balance check.

**A daily cap.** Total disbursement in a rolling 24 hours is capped, configurable
in Admin → Configuration. A compromised account cannot drain the float in one
run.

**Retryable and permanent failures are distinguished.** A timeout, a 5xx or a
rate limit puts the payout back in the queue with exponential backoff. A
validation error or an insufficient balance fails it and refunds the partner.
A rate limit never costs anyone their money.

**Lost callbacks are caught.** Anything sitting in `processing` for more than 15
minutes is re-checked against the gateway. The webhook is the fast path, not the
only path.

**Secrets are never logged.** API keys, tokens and checksums are redacted from
the call log.

---

## When something goes wrong

Everything lives under Admin → Payouts → Agent withdrawals.

| Situation | What to do |
| --- | --- |
| Payout stuck in `processing` | Press **Check**. Pazo asks the gateway and applies the real outcome. |
| Payout failed | The partner was already refunded. Press **Retry** to take it back out and send again with a fresh reference. |
| Queue not moving | Check the gateway is configured, that `payouts_enabled` is on, and whether the daily cap is reached. **Send next** forces one through. |
| Wallet not credited after a top-up | The reconciler polls for an hour. Check Admin → Wallet top-ups for the provider status. |
| Callbacks show "Unsigned" | The checksum key is not set. Set it in the portal and in `.env`. |

---

## What is not automated

Institution monthly payouts are still triggered by an admin from Admin →
Payouts → Due this month. That is deliberate: they are few, large, and worth a
human confirming before the money moves. The provider fields exist on the
payout table, so routing them through ClickPesa later is a small change.
