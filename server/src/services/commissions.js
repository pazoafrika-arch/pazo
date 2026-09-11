import { transaction } from '../db/pool.js';
import { uuid } from '../utils/crypto.js';
import { computeCommission, toMysqlDateTime } from '../utils/format.js';
import { notify } from './notifications.js';

/**
 * The commission engine. Implements PRD 6.6 POST /integrations/transactions:
 *
 *   1. Look up the referral for this tourist + business.
 *   2. No referral -> record nothing payable, return commission 0.
 *   3. Commission = amount x (partner override rate or business rate).
 *   4. Platform fee = amount x business platform fee rate.
 *   5. If the business wallet covers the commission: debit the wallet,
 *      credit the partner, mark the transaction paid, notify the partner.
 *   6. If not: store the transaction as pending and alert business + admins.
 *
 * Individual partners are credited to a withdrawable wallet balance.
 * Institutions accrue into a monthly balance paid on the 1st (PRD 3.1).
 *
 * The whole operation runs in one MySQL transaction with `SELECT ... FOR UPDATE`
 * on the wallet row, so concurrent webhooks cannot overdraw the balance.
 */
export async function processTransaction({
  business,
  touristId,
  amountTzs,
  bundleType,
  transactionType = 'first_purchase',
  transactionReference,
  paymentConfirmedAt = null,
}) {
  return transaction(async (tx) => {
    // Idempotency: the same external reference must never pay twice.
    const existing = await tx.one(
      `SELECT id, commission_tzs, platform_fee_tzs, commission_status
         FROM transactions WHERE business_id = ? AND external_tx_ref = ? LIMIT 1`,
      [business.id, transactionReference],
    );
    if (existing) {
      return {
        duplicate: true,
        commission_tzs: Number(existing.commission_tzs),
        platform_fee_tzs: Number(existing.platform_fee_tzs),
        commission_status: existing.commission_status,
        transaction_id: existing.id,
      };
    }

    const referral = await tx.one(
      `SELECT r.*, p.id AS partner_id, p.user_id AS partner_user_id, p.partner_type,
              p.commission_rate_override, p.status AS partner_status
         FROM referrals r
         JOIN partners p ON p.id = r.partner_id
        WHERE r.business_id = ? AND r.tourist_external_id = ?
        LIMIT 1`,
      [business.id, touristId],
    );

    const now = new Date();
    const nowSql = toMysqlDateTime(now);
    const confirmedAt = paymentConfirmedAt ? toMysqlDateTime(paymentConfirmedAt) : nowSql;

    // No referral: log the payment for reconciliation, pay nothing.
    if (!referral) {
      const txId = uuid();
      await tx.exec(
        `INSERT INTO transactions
           (id, referral_id, partner_id, business_id, external_tx_ref, bundle_type,
            transaction_type, amount_tzs, commission_tzs, platform_fee_tzs,
            commission_rate_applied, commission_status, failure_reason, webhook_received_at)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 'resolved', 'no_referral', ?)`,
        [txId, business.id, transactionReference, bundleType, transactionType, amountTzs, confirmedAt],
      );
      return {
        noReferral: true,
        commission_tzs: 0,
        platform_fee_tzs: 0,
        commission_status: 'resolved',
        transaction_id: txId,
      };
    }

    const rate = Number(
      referral.commission_rate_override ?? business.commission_rate,
    );
    const commission = computeCommission(amountTzs, rate);
    const platformFee = computeCommission(amountTzs, Number(business.platform_fee_rate));

    // Lock the wallet row so concurrent webhooks serialise on the balance.
    const wallet = await tx.one(
      'SELECT wallet_balance_tzs, wallet_alert_threshold_tzs FROM businesses WHERE id = ? FOR UPDATE',
      [business.id],
    );
    const balance = Number(wallet.wallet_balance_tzs);
    const suspended = referral.partner_status === 'suspended';
    const affordable = balance >= commission && commission > 0 && !suspended;

    const txId = uuid();
    const status = commission === 0 ? 'resolved' : affordable ? 'paid' : 'pending';
    const failureReason = suspended
      ? 'partner_suspended'
      : !affordable && commission > 0
        ? 'insufficient_wallet_balance'
        : null;

    await tx.exec(
      `INSERT INTO transactions
         (id, referral_id, partner_id, business_id, external_tx_ref, bundle_type,
          transaction_type, amount_tzs, commission_tzs, platform_fee_tzs,
          commission_rate_applied, commission_status, failure_reason, paid_at, webhook_received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txId,
        referral.id,
        referral.partner_id,
        business.id,
        transactionReference,
        bundleType,
        transactionType,
        amountTzs,
        commission,
        platformFee,
        rate,
        status,
        failureReason,
        affordable ? nowSql : null,
        confirmedAt,
      ],
    );

    // Referral rollups (spec 7.7).
    await tx.exec(
      `UPDATE referrals
          SET total_purchases = total_purchases + 1,
              total_value_tzs = total_value_tzs + ?,
              first_purchase_date = COALESCE(first_purchase_date, ?),
              status = 'active'
        WHERE id = ?`,
      [amountTzs, confirmedAt, referral.id],
    );

    if (affordable) {
      const newBalance = balance - commission;
      await tx.exec(
        'UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?',
        [newBalance, business.id],
      );
      await tx.exec(
        `INSERT INTO wallet_ledger
           (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, transaction_id)
         VALUES (?, ?, 'commission', ?, ?, ?, ?)`,
        [
          uuid(),
          business.id,
          -commission,
          newBalance,
          `Commission to ${referral.partner_type === 'institution' ? 'institution' : 'partner'} on ${bundleType || 'bundle'}`,
          txId,
        ],
      );

      await tx.exec(
        `UPDATE partners
            SET total_earnings_tzs = total_earnings_tzs + ?, last_active_at = ?
          WHERE id = ?`,
        [commission, nowSql, referral.partner_id],
      );

      if (referral.partner_type === 'individual') {
        await tx.exec(
          `UPDATE individual_profiles
              SET wallet_balance_tzs = wallet_balance_tzs + ?,
                  lifetime_earned_tzs = lifetime_earned_tzs + ?
            WHERE user_id = ?`,
          [commission, commission, referral.partner_user_id],
        );
        await notify(
          {
            userId: referral.partner_user_id,
            type: 'commission_paid',
            params: {
              amount: commission,
              bundle: bundleType,
              when: formatWhen(now),
            },
            data: { transaction_id: txId },
          },
          tx,
        );
      } else {
        await tx.exec(
          `UPDATE institution_profiles
              SET accumulated_balance_tzs = accumulated_balance_tzs + ?,
                  lifetime_earned_tzs = lifetime_earned_tzs + ?
            WHERE user_id = ?`,
          [commission, commission, referral.partner_user_id],
        );
        await notify(
          {
            userId: referral.partner_user_id,
            type: 'commission_accrued',
            params: { amount: commission, when: formatWhen(now) },
            data: { transaction_id: txId },
          },
          tx,
        );
      }

      // Low-balance alert once the wallet drops under the threshold.
      const threshold = Number(wallet.wallet_alert_threshold_tzs);
      if (newBalance < threshold) {
        await alertBusinessTeam(tx, business.id, 'low_wallet_balance', {
          balance: newBalance,
          threshold,
        });
      }
    } else if (commission > 0) {
      await notify(
        {
          userId: referral.partner_user_id,
          type: 'commission_pending',
          params: { amount: commission },
          data: { transaction_id: txId },
        },
        tx,
      );
      await alertBusinessTeam(tx, business.id, 'commission_unpaid_alert', {
        amount: commission,
        partner: referral.partner_type === 'institution' ? 'an institution partner' : 'a partner',
      });
    }

    return {
      commission_tzs: commission,
      platform_fee_tzs: platformFee,
      commission_status: status === 'resolved' ? 'paid' : status,
      transaction_id: txId,
      partner_id: referral.partner_id,
      reason: failureReason,
    };
  });
}

/** Notify every member of a business team plus all Pazo admins. */
async function alertBusinessTeam(tx, businessId, type, params) {
  const recipients = await tx.q(
    `SELECT user_id FROM business_members WHERE business_id = ?
     UNION
     SELECT id AS user_id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'`,
    [businessId],
  );
  for (const r of recipients) {
    await notify({ userId: r.user_id, type, params }, tx);
  }
}

function formatWhen(date) {
  const d = new Date(date);
  const day = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = d.getUTCFullYear();
  let hours = d.getUTCHours();
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} at ${hours}:${mins}${ampm}`;
}

/**
 * Retry a pending commission once the wallet has been topped up.
 * Used by the admin commission monitor and automatically after a wallet top-up.
 */
export async function settlePendingForBusiness(businessId, actorUserId = null) {
  return transaction(async (tx) => {
    const business = await tx.one(
      'SELECT * FROM businesses WHERE id = ? FOR UPDATE',
      [businessId],
    );
    if (!business) return { settled: 0, total_tzs: 0 };

    const pending = await tx.q(
      `SELECT t.*, p.partner_type, p.user_id AS partner_user_id
         FROM transactions t
         JOIN partners p ON p.id = t.partner_id
        WHERE t.business_id = ? AND t.commission_status = 'pending'
        ORDER BY t.created_at ASC`,
      [businessId],
    );

    let balance = Number(business.wallet_balance_tzs);
    let settled = 0;
    let total = 0;
    const nowSql = toMysqlDateTime(new Date());

    for (const t of pending) {
      const commission = Number(t.commission_tzs);
      if (commission > balance) break;
      balance -= commission;
      total += commission;
      settled += 1;

      await tx.exec(
        `UPDATE transactions SET commission_status = 'paid', paid_at = ?, failure_reason = NULL
          WHERE id = ?`,
        [nowSql, t.id],
      );
      await tx.exec(
        `INSERT INTO wallet_ledger
           (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, transaction_id, created_by)
         VALUES (?, ?, 'commission', ?, ?, 'Pending commission settled', ?, ?)`,
        [uuid(), businessId, -commission, balance, t.id, actorUserId],
      );
      await tx.exec(
        'UPDATE partners SET total_earnings_tzs = total_earnings_tzs + ? WHERE id = ?',
        [commission, t.partner_id],
      );

      if (t.partner_type === 'individual') {
        await tx.exec(
          `UPDATE individual_profiles
              SET wallet_balance_tzs = wallet_balance_tzs + ?,
                  lifetime_earned_tzs = lifetime_earned_tzs + ?
            WHERE user_id = ?`,
          [commission, commission, t.partner_user_id],
        );
      } else {
        await tx.exec(
          `UPDATE institution_profiles
              SET accumulated_balance_tzs = accumulated_balance_tzs + ?,
                  lifetime_earned_tzs = lifetime_earned_tzs + ?
            WHERE user_id = ?`,
          [commission, commission, t.partner_user_id],
        );
      }

      await notify(
        {
          userId: t.partner_user_id,
          type: 'commission_paid',
          params: {
            amount: commission,
            bundle: t.bundle_type,
            when: formatWhen(new Date()),
          },
          data: { transaction_id: t.id },
        },
        tx,
      );
    }

    if (settled > 0) {
      await tx.exec('UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?', [
        balance,
        businessId,
      ]);
    }
    return { settled, total_tzs: total, remaining_balance_tzs: balance };
  });
}
