import express from 'express';
import env from '../config/env.js';
import { execute, queryOne } from '../db/pool.js';
import { asyncRoute } from '../utils/http.js';
import { sha256 } from '../utils/crypto.js';
import { clientIp } from '../services/audit.js';
import { verifyChecksum, mapPayoutStatus, mapCollectionStatus } from '../services/clickpesa.js';
import {
  completeWithdrawal,
  creditWalletTopup,
  failWalletTopup,
  failWithdrawal,
  reconcileWithdrawal,
} from '../services/payments.js';

const router = express.Router();

/**
 * ClickPesa callbacks.
 *
 * This endpoint moves money, so it is written defensively:
 *
 *   1. Optional source-IP allowlist.
 *   2. HMAC-SHA256 checksum verification in constant time.
 *   3. Every event stored before processing, with a unique dedupe key, so a
 *      replayed webhook cannot be applied twice.
 *   4. When a checksum key is NOT configured, an unverified callback is never
 *      trusted on its own: the platform confirms the outcome against the
 *      gateway API before releasing or refunding anything.
 *   5. Always answers 200 once the event is stored. A non-2xx makes the
 *      provider retry, which is only useful when the platform genuinely
 *      failed to record the event.
 *
 * Events (docs.clickpesa.com/home/webhooks):
 *   PAYMENT RECEIVED, PAYMENT FAILED,
 *   PAYOUT INITIATED, PAYOUT REFUNDED, PAYOUT REVERSED,
 *   DEPOSIT RECEIVED
 */

const normaliseEvent = (e) => String(e || '').toUpperCase().replace(/[\s-]+/g, '_');

/** Reject anything not coming from an allowlisted address, when one is set. */
function ipAllowed(req) {
  const allow = env.clickpesa.webhookIpAllowlist;
  if (!allow.length) return true;
  const ip = (clientIp(req) || '').replace(/^::ffff:/, '');
  return allow.includes(ip);
}

router.post(
  '/clickpesa',
  asyncRoute(async (req, res) => {
    const ip = clientIp(req);

    if (!ipAllowed(req)) {
      console.warn(`[pazo:webhook] rejected callback from unlisted IP ${ip}`);
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const body = req.body || {};
    const event = normaliseEvent(body.event);
    const data = body.data || body;

    const orderReference = data.orderReference || data.order_reference || null;
    const providerReference = data.id || data.paymentReference || null;
    const providerStatus = data.status || null;

    // Verify the signature when a key is configured.
    const provided = body.checksum || data.checksum || null;
    const hasKey = Boolean(env.clickpesa.checksumKey);
    const signatureValid = hasKey ? verifyChecksum(body, provided) : false;

    // Dedupe on the provider's own identifiers, falling back to a hash of the
    // payload so an event without ids still cannot be applied twice.
    const dedupeKey =
      orderReference || providerReference
        ? `${event}:${orderReference || ''}:${providerReference || ''}:${providerStatus || ''}`
        : `${event}:${sha256(JSON.stringify(body)).slice(0, 48)}`;

    let eventId;
    try {
      const inserted = await execute(
        `INSERT INTO gateway_events
           (provider, event_type, order_reference, provider_reference, dedupe_key,
            payload, signature_valid, ip_address)
         VALUES ('clickpesa', ?, ?, ?, ?, ?, ?, ?)`,
        [
          event || 'UNKNOWN',
          orderReference,
          providerReference,
          dedupeKey.slice(0, 160),
          JSON.stringify(body).slice(0, 60_000),
          signatureValid ? 1 : 0,
          ip,
        ],
      );
      eventId = inserted.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Already seen and handled. Acknowledge so the provider stops retrying.
        return res.status(200).json({ success: true, data: { duplicate: true } });
      }
      throw err;
    }

    if (hasKey && !signatureValid) {
      await markProcessed(eventId, 'rejected: invalid checksum');
      console.warn(`[pazo:webhook] invalid checksum for ${event} ${orderReference} from ${ip}`);
      return res.status(401).json({ success: false, error: 'Invalid checksum' });
    }

    // Process out of band so a slow database never causes a provider timeout
    // and an unnecessary retry.
    setImmediate(() => {
      handleEvent({ eventId, event, orderReference, providerReference, providerStatus, data, trusted: signatureValid })
        .then((result) => markProcessed(eventId, result))
        .catch((err) => {
          console.error('[pazo:webhook] processing failed:', err.message);
          markProcessed(eventId, `error: ${err.message}`.slice(0, 250));
        });
    });

    return res.status(200).json({ success: true, data: { received: true } });
  }),
);

async function markProcessed(id, result) {
  try {
    await execute('UPDATE gateway_events SET processed = 1, process_result = ? WHERE id = ?', [
      String(result || 'ok').slice(0, 250),
      id,
    ]);
  } catch (err) {
    console.error('[pazo:webhook] could not mark event processed:', err.message);
  }
}

/**
 * Apply one event.
 *
 * `trusted` is true only when the checksum verified. Without it the callback
 * is treated as a hint: the platform re-reads the authoritative state from the
 * gateway rather than acting on the body it was handed.
 */
async function handleEvent({ event, orderReference, providerReference, providerStatus, data, trusted }) {
  if (!orderReference) return 'ignored: no order reference';

  /* ---- collections ---- */
  if (event === 'PAYMENT_RECEIVED' || event === 'DEPOSIT_RECEIVED') {
    const topup = await queryOne('SELECT id FROM wallet_topups WHERE order_reference = ?', [
      orderReference,
    ]);
    if (!topup) return 'ignored: unknown top-up reference';

    if (!trusted) {
      // Confirm with the gateway before crediting a wallet on an unsigned callback.
      const { reconcileStaleTopups } = await import('../services/payments.js');
      await reconcileStaleTopups({ olderThanMinutes: 0, limit: 1 });
      return 'verified against gateway';
    }

    const result = await creditWalletTopup({ orderReference, providerReference, providerStatus });
    return result.alreadyCredited ? 'already credited' : `credited ${result.amount_tzs || 0}`;
  }

  if (event === 'PAYMENT_FAILED') {
    await failWalletTopup({
      orderReference,
      reason: data?.message || 'The payment was not completed',
      providerStatus,
    });
    return 'top-up marked failed';
  }

  /* ---- payouts ---- */
  const withdrawal = await queryOne('SELECT id, status FROM withdrawals WHERE order_reference = ?', [
    orderReference,
  ]);
  if (!withdrawal) return 'ignored: unknown payout reference';

  // Anything that is not a clean signed success goes back to the gateway for
  // the authoritative answer. Refunding a partner on a forged callback would
  // be worse than a short delay.
  if (!trusted) {
    await reconcileWithdrawal(withdrawal.id);
    return 'verified against gateway';
  }

  const mapped = mapPayoutStatus(providerStatus);

  if (event === 'PAYOUT_REFUNDED' || event === 'PAYOUT_REVERSED' || mapped === 'reversed') {
    const r = await failWithdrawal({
      withdrawalId: withdrawal.id,
      reason: data?.notes || `Payout ${event.replace('PAYOUT_', '').toLowerCase()}`,
      refund: true,
      providerStatus,
    });
    return r.alreadyFinal ? 'already final' : 'refunded to partner';
  }

  if (mapped === 'completed') {
    const r = await completeWithdrawal({
      withdrawalId: withdrawal.id,
      providerReference,
      providerStatus,
      feeTzs: data?.fee !== undefined ? Math.round(Number(data.fee)) : null,
    });
    return r.alreadyFinal ? 'already final' : 'payout completed';
  }

  if (mapped === 'failed') {
    const r = await failWithdrawal({
      withdrawalId: withdrawal.id,
      reason: data?.notes || 'The payout failed at the gateway',
      refund: true,
      providerStatus,
    });
    return r.alreadyFinal ? 'already final' : 'payout failed and refunded';
  }

  await execute('UPDATE withdrawals SET provider_status = ? WHERE id = ?', [
    providerStatus ?? null,
    withdrawal.id,
  ]);
  return `status noted: ${providerStatus}`;
}

/** Lets the ClickPesa portal confirm the URL is reachable. */
router.get('/clickpesa', (req, res) =>
  res.status(200).json({ success: true, data: { endpoint: 'clickpesa', ready: true } }),
);

export default router;
