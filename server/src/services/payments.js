import { execute, query, queryOne, transaction } from '../db/pool.js';
import { uuid } from '../utils/crypto.js';
import { toMysqlDateTime } from '../utils/format.js';
import { badRequest, conflict } from '../utils/http.js';
import { notify } from './notifications.js';
import { recordAudit } from './audit.js';
import { getSetting } from './settings.js';
import { settlePendingForBusiness } from './commissions.js';
import * as gateway from './clickpesa.js';

/**
 * Money movement through ClickPesa.
 *
 *   Collection: a business funds its wallet. The wallet is credited ONLY when
 *               the provider confirms, never when the request is made.
 *   Payout:     an agent is paid. The partner balance is debited when the
 *               request is accepted, and refunded if the payout finally fails.
 *
 * Every state change is guarded so a replayed webhook, a concurrent status
 * poll and a retry can all run at once without double-crediting anyone.
 */

/* ================================================================== */
/* COLLECTIONS — funding a business wallet                             */
/* ================================================================== */

/**
 * Start a mobile money top-up. Creates the intent row first so the provider
 * can never call back about a reference the platform does not know.
 */
export async function startWalletTopup({ business, amountTzs, phoneNumber, actor }) {
  const minTopup = Number(await getSetting('topup_min_tzs', 10_000));
  const amount = Math.floor(Number(amountTzs));

  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter an amount to top up');
  if (amount < minTopup)
    throw badRequest(`The smallest top-up is TZS ${minTopup.toLocaleString('en-US')}`);
  if (!gateway.toGatewayPhone(phoneNumber))
    throw badRequest('Enter a valid mobile money number');

  const orderReference = gateway.makeOrderReference('TU');
  const topupId = uuid();

  await execute(
    `INSERT INTO wallet_topups
       (id, business_id, order_reference, method, amount_tzs, phone_number, status, requested_by)
     VALUES (?, ?, ?, 'mobile_money', ?, ?, 'pending', ?)`,
    [topupId, business.id, orderReference, amount, phoneNumber, actor?.id ?? null],
  );

  try {
    const res = await gateway.initiateCollection({
      amountTzs: amount,
      phoneNumber,
      orderReference,
    });

    await execute(
      `UPDATE wallet_topups
          SET status = 'processing', provider_reference = ?, provider_status = ?, channel = ?
        WHERE id = ?`,
      [res?.id ?? null, res?.status ?? null, res?.channel ?? null, topupId],
    );

    await recordAudit({
      actor,
      action: 'business.topup_initiated',
      resourceType: 'wallet_topup',
      resourceId: topupId,
      detail: { amount_tzs: amount, order_reference: orderReference },
    });

    return {
      topup_id: topupId,
      order_reference: orderReference,
      amount_tzs: amount,
      status: 'processing',
      channel: res?.channel ?? null,
      message: 'Approve the prompt on your phone to complete the top-up.',
    };
  } catch (err) {
    await execute(
      `UPDATE wallet_topups SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [String(err.message).slice(0, 250), topupId],
    );
    throw err;
  }
}

/**
 * Credit a business wallet for a confirmed top-up.
 *
 * The `credited` flag is set inside the same transaction that moves the money
 * and is checked under a row lock first, so a webhook delivered twice (or a
 * webhook racing a status poll) credits exactly once.
 */
export async function creditWalletTopup({ orderReference, providerReference, providerStatus }) {
  const result = await transaction(async (tx) => {
    const topup = await tx.one(
      'SELECT * FROM wallet_topups WHERE order_reference = ? FOR UPDATE',
      [orderReference],
    );
    if (!topup) return { ok: false, reason: 'unknown_reference' };
    if (topup.credited) return { ok: true, alreadyCredited: true, topup_id: topup.id };

    const business = await tx.one('SELECT * FROM businesses WHERE id = ? FOR UPDATE', [
      topup.business_id,
    ]);
    if (!business) return { ok: false, reason: 'unknown_business' };

    const amount = Number(topup.amount_tzs);
    const newBalance = Number(business.wallet_balance_tzs) + amount;

    await tx.exec('UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?', [
      newBalance,
      business.id,
    ]);
    await tx.exec(
      `INSERT INTO wallet_ledger
         (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, created_by)
       VALUES (?, ?, 'topup', ?, ?, ?, ?)`,
      [
        uuid(),
        business.id,
        amount,
        newBalance,
        `Wallet top-up via ClickPesa — ref ${orderReference}`,
        topup.requested_by,
      ],
    );
    await tx.exec(
      `UPDATE wallet_topups
          SET status = 'completed', credited = 1, credited_at = UTC_TIMESTAMP(),
              provider_reference = COALESCE(?, provider_reference),
              provider_status = COALESCE(?, provider_status)
        WHERE id = ?`,
      [providerReference ?? null, providerStatus ?? null, topup.id],
    );

    const members = await tx.q('SELECT user_id FROM business_members WHERE business_id = ?', [
      business.id,
    ]);
    for (const m of members) {
      await notify(
        {
          userId: m.user_id,
          type: 'custom',
          params: {
            title: 'Wallet topped up',
            body: `TZS ${amount.toLocaleString('en-US')} has been credited to your Pazo wallet. New balance: TZS ${newBalance.toLocaleString('en-US')}.`,
          },
        },
        tx,
      );
    }

    return { ok: true, topup_id: topup.id, business_id: business.id, amount_tzs: amount };
  });

  // A top-up should immediately release commissions that were waiting on funds.
  if (result.ok && !result.alreadyCredited && result.business_id) {
    try {
      result.settled = await settlePendingForBusiness(result.business_id, null);
    } catch (err) {
      console.error('[pazo:payments] settle after topup failed:', err.message);
    }
  }
  return result;
}

export async function failWalletTopup({ orderReference, reason, providerStatus }) {
  const res = await execute(
    `UPDATE wallet_topups
        SET status = 'failed', failure_reason = ?, provider_status = COALESCE(?, provider_status)
      WHERE order_reference = ? AND credited = 0 AND status <> 'completed'`,
    [String(reason || 'Payment was not completed').slice(0, 250), providerStatus ?? null, orderReference],
  );
  return { ok: res.affectedRows > 0 };
}

/* ================================================================== */
/* PAYOUTS — paying an agent                                           */
/* ================================================================== */

/**
 * Look up where a withdrawal will land and what it costs, without moving
 * anything. The account name comes from the mobile operator, so the partner
 * confirms a real name rather than just a number.
 */
export async function previewWithdrawal({ amountTzs, phoneNumber }) {
  const preview = await gateway.previewPayout({
    amountTzs,
    phoneNumber,
    orderReference: gateway.makeOrderReference('PV'),
  });

  return {
    amount_tzs: Math.round(Number(preview?.receiver?.amount ?? amountTzs)),
    fee_tzs: Math.round(Number(preview?.fee ?? 0)),
    total_tzs: Math.round(Number(preview?.amount ?? amountTzs)),
    beneficiary_name: preview?.receiver?.accountName || null,
    channel_provider: preview?.channelProvider || null,
  };
}

/**
 * Send one queued withdrawal to the gateway.
 *
 * Claims the row with a conditional UPDATE, so two workers (or a worker and a
 * manual retry) can never submit the same withdrawal twice. On a retryable
 * failure the row returns to `queued` with a backoff; on a permanent failure
 * the partner is refunded.
 */
export async function submitWithdrawal(withdrawalId) {
  const claimed = await execute(
    `UPDATE withdrawals
        SET status = 'processing', attempts = attempts + 1, last_attempt_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'queued'`,
    [withdrawalId],
  );
  if (!claimed.affectedRows) return { skipped: true, reason: 'not_queued' };

  const w = await queryOne(
    `SELECT w.*, p.user_id, u.name AS partner_name
       FROM withdrawals w
       JOIN partners p ON p.id = w.partner_id
       JOIN users u ON u.id = p.user_id
      WHERE w.id = ?`,
    [withdrawalId],
  );
  if (!w) return { skipped: true, reason: 'missing' };

  // The reference is generated once and reused across retries, so a retry of a
  // request the provider actually accepted returns 409 instead of paying twice.
  let orderReference = w.order_reference;
  if (!orderReference) {
    orderReference = gateway.makeOrderReference('PO');
    await execute('UPDATE withdrawals SET order_reference = ? WHERE id = ?', [
      orderReference,
      withdrawalId,
    ]);
  }

  try {
    const res = await gateway.createPayout({
      amountTzs: Number(w.amount_tzs),
      phoneNumber: w.mobile_money_number,
      orderReference,
    });

    const mapped = gateway.mapPayoutStatus(res?.status);
    await execute(
      `UPDATE withdrawals
          SET provider_reference = ?, provider_status = ?, fee_tzs = ?,
              beneficiary_name = COALESCE(?, beneficiary_name),
              channel_provider = COALESCE(?, channel_provider),
              status = ?, next_attempt_at = NULL,
              completed_at = CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP() ELSE completed_at END
        WHERE id = ?`,
      [
        res?.id ?? null,
        res?.status ?? null,
        Math.round(Number(res?.fee ?? 0)),
        res?.beneficiary?.accountName ?? null,
        res?.channelProvider ?? null,
        mapped === 'completed' ? 'completed' : 'processing',
        mapped,
        withdrawalId,
      ],
    );

    if (mapped === 'completed') {
      await notify({
        userId: w.user_id,
        type: 'withdrawal_complete',
        params: { amount: Number(w.amount_tzs) },
        data: { withdrawal_id: withdrawalId, reference: res?.id },
      });
    }

    return { ok: true, status: mapped, order_reference: orderReference };
  } catch (err) {
    // The provider already has this reference: it was accepted on an earlier
    // attempt. Never refund here — ask the gateway what actually happened.
    if (err.code === 'duplicate_reference') {
      await reconcileWithdrawal(withdrawalId);
      return { ok: true, reconciled: true };
    }

    const maxAttempts = Number(await getSetting('payout_max_attempts', 4));
    const attempts = Number(w.attempts) + 1;
    const canRetry = err.retryable && attempts < maxAttempts;

    if (canRetry) {
      // Exponential backoff: 1, 4, 9 minutes.
      const delayMs = Math.min(30, attempts * attempts) * 60_000;
      await execute(
        `UPDATE withdrawals SET status = 'queued', next_attempt_at = ?, provider_status = ? WHERE id = ?`,
        [toMysqlDateTime(new Date(Date.now() + delayMs)), String(err.code || 'error'), withdrawalId],
      );
      return { ok: false, retrying: true, attempts, error: err.message };
    }

    await failWithdrawal({ withdrawalId, reason: err.message, refund: true });
    return { ok: false, failed: true, error: err.message };
  }
}

/**
 * Mark a withdrawal failed and return the money to the partner.
 *
 * The refund is conditional on the row not already being terminal, so a
 * webhook and a poll arriving together cannot refund twice.
 */
export async function failWithdrawal({ withdrawalId, reason, refund = true, providerStatus = null }) {
  return transaction(async (tx) => {
    const w = await tx.one(
      `SELECT w.*, p.user_id FROM withdrawals w
         JOIN partners p ON p.id = w.partner_id
        WHERE w.id = ? FOR UPDATE`,
      [withdrawalId],
    );
    if (!w) return { ok: false, reason: 'missing' };
    if (['failed', 'reversed', 'completed'].includes(w.status))
      return { ok: true, alreadyFinal: true, status: w.status };

    const status = providerStatus && gateway.mapPayoutStatus(providerStatus) === 'reversed'
      ? 'reversed'
      : 'failed';

    await tx.exec(
      `UPDATE withdrawals
          SET status = ?, failure_reason = ?, provider_status = COALESCE(?, provider_status),
              completed_at = UTC_TIMESTAMP(), next_attempt_at = NULL
        WHERE id = ?`,
      [status, String(reason || 'Payment could not be completed').slice(0, 250), providerStatus, withdrawalId],
    );

    if (refund) {
      await tx.exec(
        `UPDATE individual_profiles
            SET wallet_balance_tzs = wallet_balance_tzs + ?,
                lifetime_withdrawn_tzs = GREATEST(0, lifetime_withdrawn_tzs - ?)
          WHERE user_id = ?`,
        [Number(w.amount_tzs), Number(w.amount_tzs), w.user_id],
      );
      await notify(
        {
          userId: w.user_id,
          type: 'withdrawal_failed',
          params: { amount: Number(w.amount_tzs), reason },
        },
        tx,
      );
    }

    return { ok: true, status, refunded_tzs: refund ? Number(w.amount_tzs) : 0 };
  });
}

/** Mark a withdrawal complete. Idempotent: a second call changes nothing. */
export async function completeWithdrawal({ withdrawalId, providerReference, providerStatus, feeTzs }) {
  const w = await queryOne(
    `SELECT w.*, p.user_id FROM withdrawals w
       JOIN partners p ON p.id = w.partner_id WHERE w.id = ?`,
    [withdrawalId],
  );
  if (!w) return { ok: false, reason: 'missing' };
  if (w.status === 'completed') return { ok: true, alreadyFinal: true };

  const res = await execute(
    `UPDATE withdrawals
        SET status = 'completed', completed_at = UTC_TIMESTAMP(), next_attempt_at = NULL,
            provider_reference = COALESCE(?, provider_reference),
            provider_status = COALESCE(?, provider_status),
            fee_tzs = COALESCE(?, fee_tzs)
      WHERE id = ? AND status IN ('queued','processing')`,
    [providerReference ?? null, providerStatus ?? null, feeTzs ?? null, withdrawalId],
  );
  if (!res.affectedRows) return { ok: true, alreadyFinal: true };

  await notify({
    userId: w.user_id,
    type: 'withdrawal_complete',
    params: { amount: Number(w.amount_tzs) },
    data: { withdrawal_id: withdrawalId, reference: providerReference },
  });
  return { ok: true, status: 'completed' };
}

/**
 * Ask the gateway what actually happened and bring the local row into line.
 * This is the safety net for a lost webhook or an ambiguous failure.
 */
export async function reconcileWithdrawal(withdrawalId) {
  const w = await queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
  if (!w?.order_reference) return { ok: false, reason: 'no_reference' };
  if (['completed', 'failed', 'reversed'].includes(w.status))
    return { ok: true, alreadyFinal: true, status: w.status };

  let remote;
  try {
    remote = await gateway.getPayoutStatus(w.order_reference);
  } catch (err) {
    if (err.code === 'not_found') {
      // The provider never accepted it, so it is safe to refund.
      await failWithdrawal({
        withdrawalId,
        reason: 'The payment gateway has no record of this payout',
        refund: true,
      });
      return { ok: true, status: 'failed' };
    }
    return { ok: false, error: err.message };
  }

  const mapped = gateway.mapPayoutStatus(remote?.status);
  if (mapped === 'completed') {
    await completeWithdrawal({
      withdrawalId,
      providerReference: remote?.id,
      providerStatus: remote?.status,
      feeTzs: Math.round(Number(remote?.fee ?? 0)),
    });
  } else if (mapped === 'failed' || mapped === 'reversed') {
    await failWithdrawal({
      withdrawalId,
      reason: remote?.notes || `Gateway reported ${remote?.status}`,
      refund: true,
      providerStatus: remote?.status,
    });
  } else {
    await execute('UPDATE withdrawals SET provider_status = ? WHERE id = ?', [
      remote?.status ?? null,
      withdrawalId,
    ]);
  }
  return { ok: true, status: mapped };
}

/* ================================================================== */
/* QUEUE                                                               */
/* ================================================================== */

/**
 * Drain the payout queue.
 *
 * The provider allows one payout creation per merchant per 60 seconds, so this
 * sends exactly one withdrawal per tick, oldest first. A daily cap stops a
 * compromised account from draining the float in a single run.
 */
export async function drainPayoutQueue() {
  if (!gateway.isConfigured()) return { skipped: 'not_configured' };

  const enabled = await getSetting('payouts_enabled', true);
  if (!enabled) return { skipped: 'disabled' };

  const cap = Number(await getSetting('payout_daily_cap_tzs', 20_000_000));
  const sentToday = await queryOne(
    `SELECT COALESCE(SUM(amount_tzs),0) AS total FROM withdrawals
      WHERE status IN ('processing','completed')
        AND last_attempt_at > (UTC_TIMESTAMP() - INTERVAL 1 DAY)`,
  );
  if (Number(sentToday.total) >= cap) {
    console.warn('[pazo:payouts] daily cap reached, holding the queue');
    return { skipped: 'daily_cap' };
  }

  const next = await queryOne(
    `SELECT id, amount_tzs FROM withdrawals
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
      ORDER BY requested_at ASC LIMIT 1`,
  );
  if (!next) return { sent: 0 };

  if (Number(sentToday.total) + Number(next.amount_tzs) > cap) {
    return { skipped: 'daily_cap' };
  }

  const result = await submitWithdrawal(next.id);
  return { sent: 1, withdrawal_id: next.id, ...result };
}

/**
 * Re-check anything that has been sitting in `processing` for a while. Covers
 * webhooks that never arrived.
 */
export async function reconcileStalePayouts({ olderThanMinutes = 15, limit = 10 } = {}) {
  if (!gateway.isConfigured()) return { checked: 0 };

  const stale = await query(
    `SELECT id FROM withdrawals
      WHERE status = 'processing'
        AND order_reference IS NOT NULL
        AND last_attempt_at < (UTC_TIMESTAMP() - INTERVAL ? MINUTE)
      ORDER BY last_attempt_at ASC LIMIT ?`,
    [olderThanMinutes, limit],
  );

  let resolved = 0;
  for (const row of stale) {
    const r = await reconcileWithdrawal(row.id);
    if (r.ok && r.status && r.status !== 'processing') resolved += 1;
  }
  return { checked: stale.length, resolved };
}

/** Same idea for top-ups the payer may have abandoned on their handset. */
export async function reconcileStaleTopups({ olderThanMinutes = 10, limit = 10 } = {}) {
  if (!gateway.isConfigured()) return { checked: 0 };

  const stale = await query(
    `SELECT id, order_reference FROM wallet_topups
      WHERE status IN ('pending','processing') AND credited = 0
        AND created_at < (UTC_TIMESTAMP() - INTERVAL ? MINUTE)
      ORDER BY created_at ASC LIMIT ?`,
    [olderThanMinutes, limit],
  );

  let resolved = 0;
  for (const t of stale) {
    try {
      const remote = await gateway.getCollectionStatus(t.order_reference);
      const entry = Array.isArray(remote) ? remote[remote.length - 1] : remote;
      const mapped = gateway.mapCollectionStatus(entry?.status);
      if (mapped === 'completed') {
        await creditWalletTopup({
          orderReference: t.order_reference,
          providerReference: entry?.id,
          providerStatus: entry?.status,
        });
        resolved += 1;
      } else if (mapped === 'failed') {
        await failWalletTopup({
          orderReference: t.order_reference,
          reason: 'The payment was not completed',
          providerStatus: entry?.status,
        });
        resolved += 1;
      }
    } catch (err) {
      if (err.code === 'not_found') {
        await failWalletTopup({
          orderReference: t.order_reference,
          reason: 'The gateway has no record of this payment',
        });
        resolved += 1;
      }
    }
  }

  // Anything still unresolved after an hour is abandoned.
  await execute(
    `UPDATE wallet_topups SET status = 'expired'
      WHERE status IN ('pending','processing') AND credited = 0
        AND created_at < (UTC_TIMESTAMP() - INTERVAL 1 HOUR)`,
  );

  return { checked: stale.length, resolved };
}
