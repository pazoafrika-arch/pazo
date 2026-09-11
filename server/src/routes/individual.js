import express from 'express';
import { execute, query, queryOne, transaction } from '../db/pool.js';
import { asyncRoute, badRequest, conflict, notFound, ok, pagination, paged } from '../utils/http.js';
import { uuid } from '../utils/crypto.js';
import {
  buildReferralLink,
  displayPhone,
  isEmail,
  maskPhone,
  normalisePhone,
  toMysqlDateTime,
} from '../utils/format.js';
import { requireAuth, requireRole, loadPartner } from '../middleware/auth.js';
import { getSetting } from '../services/settings.js';
import { notify } from '../services/notifications.js';
import { qrDataUrl, qrPngBuffer } from '../services/qr.js';
import { issueOtp, verifyOtp } from '../services/otp.js';
import { recordAudit, clientIp } from '../services/audit.js';
import { previewWithdrawal, submitWithdrawal } from '../services/payments.js';

const router = express.Router();
router.use(requireAuth, requireRole('individual'), loadPartner);

/* ------------------------------------------------------------------ */
/* GET /individual/me                                                  */
/* ------------------------------------------------------------------ */
router.get(
  '/me',
  asyncRoute(async (req, res) => {
    const profile = await queryOne(
      'SELECT * FROM individual_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id],
    );
    return ok(res, {
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        phone_display: displayPhone(req.user.phone),
        avatar_color: req.user.avatar_color,
        member_since: req.user.created_at,
      },
      profile: {
        first_name: profile.first_name,
        last_name: profile.last_name,
        whatsapp_number: profile.whatsapp_number,
        whatsapp_display: displayPhone(profile.whatsapp_number),
        mobile_money_number: profile.mobile_money_number,
        mobile_money_masked: maskPhone(profile.mobile_money_number),
        mobile_money_verified: !!profile.mobile_money_verified,
        wallet_balance_tzs: Number(profile.wallet_balance_tzs),
        lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
        lifetime_withdrawn_tzs: Number(profile.lifetime_withdrawn_tzs),
      },
      partner: {
        referral_code: req.partner.referral_code,
        referral_link: buildReferralLink(req.partner.signup_url_template, req.partner.referral_code),
        business_name: req.partner.business_name,
        status: req.partner.status,
        commission_rate: Number(
          req.partner.commission_rate_override ?? req.partner.business_commission_rate,
        ),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* PUT /individual/me                                                  */
/* ------------------------------------------------------------------ */
router.put(
  '/me',
  asyncRoute(async (req, res) => {
    const { first_name, last_name, email, whatsapp_number } = req.body || {};
    const updates = {};

    if (first_name !== undefined || last_name !== undefined) {
      const profile = await queryOne(
        'SELECT first_name, last_name FROM individual_profiles WHERE user_id = ?',
        [req.user.id],
      );
      const fn = String(first_name ?? profile.first_name).trim();
      const ln = String(last_name ?? profile.last_name).trim();
      if (fn.length < 2 || ln.length < 2) throw badRequest('Enter your full name');
      await execute(
        'UPDATE individual_profiles SET first_name = ?, last_name = ? WHERE user_id = ?',
        [fn, ln, req.user.id],
      );
      await execute('UPDATE users SET name = ? WHERE id = ?', [`${fn} ${ln}`, req.user.id]);
      updates.name = `${fn} ${ln}`;
    }

    if (email !== undefined) {
      const clean = String(email).trim().toLowerCase();
      if (!isEmail(clean)) throw badRequest('Enter a valid email address');
      const taken = await queryOne('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [
        clean,
        req.user.id,
      ]);
      if (taken) throw conflict('That email is already in use');
      await execute('UPDATE users SET email = ? WHERE id = ?', [clean, req.user.id]);
      updates.email = clean;
    }

    if (whatsapp_number !== undefined) {
      const clean = normalisePhone(whatsapp_number);
      if (!clean) throw badRequest('Enter a valid WhatsApp number');
      await execute('UPDATE individual_profiles SET whatsapp_number = ? WHERE user_id = ?', [
        clean,
        req.user.id,
      ]);
      updates.whatsapp_number = clean;
    }

    return ok(res, { updated: true, ...updates });
  }),
);

/* ------------------------------------------------------------------ */
/* Changing the login phone or mobile money number needs a fresh OTP   */
/* on the NEW number (spec 2.7).                                       */
/* ------------------------------------------------------------------ */
router.post(
  '/me/phone/request-otp',
  asyncRoute(async (req, res) => {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) throw badRequest('Enter a valid Tanzanian phone number');
    const taken = await queryOne('SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1', [
      phone,
      req.user.id,
    ]);
    if (taken) throw conflict('That number already belongs to another account');
    const result = await issueOtp({ identifier: phone, channel: 'sms', purpose: 'change_phone' });
    return ok(res, { ...result, phone });
  }),
);

router.post(
  '/me/phone/confirm',
  asyncRoute(async (req, res) => {
    const phone = normalisePhone(req.body?.phone);
    const { code } = req.body || {};
    if (!phone) throw badRequest('Enter a valid Tanzanian phone number');
    await verifyOtp({ identifier: phone, purpose: 'change_phone', code });
    await execute('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', [phone, req.user.id]);
    await recordAudit({
      actor: req.user,
      action: 'individual.phone_changed',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, { updated: true, phone, phone_display: displayPhone(phone) });
  }),
);

router.post(
  '/me/payout/request-otp',
  asyncRoute(async (req, res) => {
    const number = normalisePhone(req.body?.mobile_money_number);
    if (!number) throw badRequest('Enter a valid mobile money number');
    const result = await issueOtp({
      identifier: number,
      channel: 'sms',
      purpose: 'change_payout',
    });
    return ok(res, { ...result, mobile_money_number: number });
  }),
);

router.post(
  '/me/payout/confirm',
  asyncRoute(async (req, res) => {
    const number = normalisePhone(req.body?.mobile_money_number);
    const { code, provider } = req.body || {};
    if (!number) throw badRequest('Enter a valid mobile money number');
    await verifyOtp({ identifier: number, purpose: 'change_payout', code });
    await execute(
      `UPDATE individual_profiles
          SET mobile_money_number = ?, mobile_money_provider = ?, mobile_money_verified = 1
        WHERE user_id = ?`,
      [number, provider || null, req.user.id],
    );
    await recordAudit({
      actor: req.user,
      action: 'individual.payout_account_changed',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, { updated: true, mobile_money_masked: maskPhone(number) });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/home - everything the home screen needs          */
/* ------------------------------------------------------------------ */
router.get(
  '/me/home',
  asyncRoute(async (req, res) => {
    const [profile, stats, activity, unread, announcement] = await Promise.all([
      queryOne('SELECT * FROM individual_profiles WHERE user_id = ?', [req.user.id]),
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ?) AS total_referrals,
           (SELECT COUNT(*) FROM referral_clicks WHERE partner_id = ?) AS total_clicks,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
             WHERE partner_id = ? AND commission_status = 'paid'
               AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS earned_this_month,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
             WHERE partner_id = ? AND commission_status = 'pending') AS pending_tzs`,
        [req.partner.id, req.partner.id, req.partner.id, req.partner.id],
      ),
      recentActivity(req.partner.id, 10),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [
        req.user.id,
      ]),
      queryOne(
        `SELECT id, title, body, variant FROM announcements
          WHERE active = 1 AND audience IN ('all','individuals')
            AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
            AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP())
          ORDER BY created_at DESC LIMIT 1`,
      ),
    ]);

    return ok(res, {
      greeting_name: (req.user.name || '').split(' ')[0],
      wallet_balance_tzs: Number(profile.wallet_balance_tzs),
      pending_tzs: Number(stats.pending_tzs),
      earned_this_month_tzs: Number(stats.earned_this_month),
      lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
      total_referrals: Number(stats.total_referrals),
      total_clicks: Number(stats.total_clicks),
      referral_code: req.partner.referral_code,
      referral_link: buildReferralLink(req.partner.signup_url_template, req.partner.referral_code),
      mobile_money_masked: maskPhone(profile.mobile_money_number),
      unread_notifications: Number(unread.n),
      announcement: announcement || null,
      activity,
    });
  }),
);

/** Merged feed of commissions, referral signups and withdrawals (spec 2.4). */
async function recentActivity(partnerId, limit = 10) {
  const rows = await query(
    `(SELECT 'commission' AS kind, t.id, t.commission_tzs AS amount_tzs, t.bundle_type AS label,
             t.commission_status AS status, t.created_at
        FROM transactions t
       WHERE t.partner_id = ? AND t.commission_tzs > 0)
     UNION ALL
     (SELECT 'referral' AS kind, r.id, 0 AS amount_tzs, NULL AS label,
             r.status, r.created_at
        FROM referrals r WHERE r.partner_id = ?)
     UNION ALL
     (SELECT 'withdrawal' AS kind, w.id, w.amount_tzs, w.mobile_money_number AS label,
             w.status, w.requested_at AS created_at
        FROM withdrawals w WHERE w.partner_id = ?)
     ORDER BY created_at DESC
     LIMIT ?`,
    [partnerId, partnerId, partnerId, limit],
  );

  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    amount_tzs: Number(r.amount_tzs),
    label: r.kind === 'withdrawal' ? maskPhone(r.label) : r.label,
    status: r.status,
    created_at: r.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* GET /individual/me/wallet                                           */
/* ------------------------------------------------------------------ */
router.get(
  '/me/wallet',
  asyncRoute(async (req, res) => {
    const profile = await queryOne('SELECT * FROM individual_profiles WHERE user_id = ?', [
      req.user.id,
    ]);
    const minWithdrawal = await getSetting('min_withdrawal_tzs', 5000);
    const pending = await queryOne(
      `SELECT COALESCE(SUM(amount_tzs),0) AS n FROM withdrawals
        WHERE partner_id = ? AND status IN ('queued','processing')`,
      [req.partner.id],
    );

    return ok(res, {
      balance_tzs: Number(profile.wallet_balance_tzs),
      lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
      lifetime_withdrawn_tzs: Number(profile.lifetime_withdrawn_tzs),
      withdrawals_processing_tzs: Number(pending.n),
      min_withdrawal_tzs: Number(minWithdrawal),
      mobile_money_masked: maskPhone(profile.mobile_money_number),
      mobile_money_verified: !!profile.mobile_money_verified,
      can_withdraw:
        !!profile.mobile_money_verified &&
        Number(profile.wallet_balance_tzs) >= Number(minWithdrawal),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/transactions                                     */
/* ------------------------------------------------------------------ */
router.get(
  '/me/transactions',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const status = req.query.status;
    const where = ['partner_id = ?', 'commission_tzs > 0'];
    const params = [req.partner.id];
    if (status && ['paid', 'pending', 'failed'].includes(status)) {
      where.push('commission_status = ?');
      params.push(status);
    }
    const whereSql = where.join(' AND ');

    const [rows, count] = await Promise.all([
      query(
        `SELECT id, bundle_type, transaction_type, commission_tzs, commission_status, created_at, paid_at
           FROM transactions WHERE ${whereSql}
          ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM transactions WHERE ${whereSql}`, params),
    ]);

    // Never expose tourist identity here (privacy rule).
    const items = rows.map((r) => ({
      id: r.id,
      bundle_type: r.bundle_type,
      transaction_type: r.transaction_type,
      commission_tzs: Number(r.commission_tzs),
      status: r.commission_status,
      created_at: r.created_at,
      paid_at: r.paid_at,
    }));

    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/withdrawals                                      */
/* ------------------------------------------------------------------ */
router.get(
  '/me/withdrawals',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count] = await Promise.all([
      query(
        `SELECT id, amount_tzs, fee_tzs, mobile_money_number, beneficiary_name, channel_provider,
                status, provider_reference, failure_reason, requested_at, completed_at
           FROM withdrawals WHERE partner_id = ?
          ORDER BY requested_at DESC LIMIT ? OFFSET ?`,
        [req.partner.id, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM withdrawals WHERE partner_id = ?', [req.partner.id]),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      amount_tzs: Number(r.amount_tzs),
      fee_tzs: Number(r.fee_tzs),
      destination: maskPhone(r.mobile_money_number),
      beneficiary_name: r.beneficiary_name,
      channel_provider: r.channel_provider,
      // 'queued' is an internal state; to the partner it is simply in progress.
      status: r.status === 'queued' ? 'processing' : r.status,
      reference: r.provider_reference,
      failure_reason: r.failure_reason,
      requested_at: r.requested_at,
      completed_at: r.completed_at,
    }));
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/balance-history (running balance, spec 2.5)      */
/* ------------------------------------------------------------------ */
router.get(
  '/me/balance-history',
  asyncRoute(async (req, res) => {
    const { limit } = pagination(req, 50, 200);
    const rows = await query(
      `(SELECT 'earning' AS kind, id, commission_tzs AS delta_tzs, bundle_type AS label, created_at
          FROM transactions
         WHERE partner_id = ? AND commission_status = 'paid' AND commission_tzs > 0)
       UNION ALL
       (SELECT 'withdrawal' AS kind, id, -amount_tzs AS delta_tzs, mobile_money_number AS label, requested_at AS created_at
          FROM withdrawals WHERE partner_id = ? AND status NOT IN ('failed','reversed'))
       ORDER BY created_at ASC`,
      [req.partner.id, req.partner.id],
    );

    let running = 0;
    const history = rows.map((r) => {
      running += Number(r.delta_tzs);
      return {
        kind: r.kind,
        id: r.id,
        delta_tzs: Number(r.delta_tzs),
        label: r.kind === 'withdrawal' ? maskPhone(r.label) : r.label,
        balance_after_tzs: running,
        created_at: r.created_at,
      };
    });

    history.reverse();
    return ok(res, { items: history.slice(0, limit), current_balance_tzs: running });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /individual/me/withdraw                                        */
/* ------------------------------------------------------------------ */
router.post(
  '/me/withdraw',
  asyncRoute(async (req, res) => {
    const amount = Math.floor(Number(req.body?.amount_tzs));
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter an amount to withdraw');

    const minWithdrawal = Number(await getSetting('min_withdrawal_tzs', 5000));
    const maxWithdrawal = Number(await getSetting('max_withdrawal_tzs', 3_000_000));
    if (amount < minWithdrawal)
      throw badRequest(`The smallest withdrawal is TZS ${minWithdrawal.toLocaleString('en-US')}`);
    if (amount > maxWithdrawal)
      throw badRequest(`The largest single withdrawal is TZS ${maxWithdrawal.toLocaleString('en-US')}`);

    const result = await transaction(async (tx) => {
      const profile = await tx.one(
        'SELECT * FROM individual_profiles WHERE user_id = ? FOR UPDATE',
        [req.user.id],
      );
      if (!profile.mobile_money_verified || !profile.mobile_money_number)
        throw badRequest('Add and verify your mobile money number first');
      const balance = Number(profile.wallet_balance_tzs);
      if (amount > balance)
        throw badRequest(
          `You can withdraw up to TZS ${balance.toLocaleString('en-US')} right now`,
        );

      // One withdrawal in flight at a time. Two simultaneous requests against
      // the same balance would otherwise both pass the balance check.
      const inFlight = await tx.one(
        `SELECT COUNT(*) AS n FROM withdrawals
          WHERE partner_id = ? AND status IN ('queued','processing')`,
        [req.partner.id],
      );
      if (Number(inFlight.n) > 0)
        throw conflict('You already have a withdrawal in progress. Wait for it to finish.');

      const withdrawalId = uuid();
      // Queued, not processing: the balance is debited now, and a worker sends
      // it to ClickPesa, which accepts only one payout per minute.
      await tx.exec(
        `INSERT INTO withdrawals
           (id, partner_id, amount_tzs, mobile_money_number, status, provider)
         VALUES (?, ?, ?, ?, 'queued', 'clickpesa')`,
        [withdrawalId, req.partner.id, amount, profile.mobile_money_number],
      );
      await tx.exec(
        `UPDATE individual_profiles
            SET wallet_balance_tzs = wallet_balance_tzs - ?,
                lifetime_withdrawn_tzs = lifetime_withdrawn_tzs + ?
          WHERE user_id = ?`,
        [amount, amount, req.user.id],
      );
      await notify(
        { userId: req.user.id, type: 'withdrawal_requested', params: { amount } },
        tx,
      );

      return {
        id: withdrawalId,
        amount_tzs: amount,
        destination: maskPhone(profile.mobile_money_number),
        balance_after_tzs: balance - amount,
      };
    });

    await recordAudit({
      actor: req.user,
      action: 'individual.withdrawal_requested',
      resourceType: 'withdrawal',
      resourceId: result.id,
      detail: { amount_tzs: amount },
      ip: clientIp(req),
    });

    // Try to send it straight away. If the gateway is rate limited or briefly
    // unavailable the row simply stays queued and the worker picks it up.
    submitWithdrawal(result.id).catch((err) =>
      console.error('[pazo] immediate payout submit failed:', err.message),
    );

    return ok(res, { ...result, status: 'processing' }, 201);
  }),
);

/* ------------------------------------------------------------------ */
/* POST /individual/me/withdraw/preview                                */
/* Shows the fee and the name the mobile operator holds for the number, */
/* so money never leaves on a mistyped account.                        */
/* ------------------------------------------------------------------ */
router.post(
  '/me/withdraw/preview',
  asyncRoute(async (req, res) => {
    const amount = Math.floor(Number(req.body?.amount_tzs));
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter an amount to withdraw');

    const profile = await queryOne(
      'SELECT mobile_money_number, mobile_money_verified, wallet_balance_tzs FROM individual_profiles WHERE user_id = ?',
      [req.user.id],
    );
    if (!profile?.mobile_money_verified || !profile.mobile_money_number)
      throw badRequest('Add and verify your mobile money number first');
    if (amount > Number(profile.wallet_balance_tzs))
      throw badRequest(
        `You can withdraw up to TZS ${Number(profile.wallet_balance_tzs).toLocaleString('en-US')} right now`,
      );

    // A preview is a convenience, never a gate. If the gateway is unreachable
    // the withdrawal can still be requested.
    try {
      const preview = await previewWithdrawal({
        amountTzs: amount,
        phoneNumber: profile.mobile_money_number,
      });
      return ok(res, { available: true, ...preview });
    } catch (err) {
      return ok(res, {
        available: false,
        amount_tzs: amount,
        fee_tzs: 0,
        reason: err.message,
      });
    }
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/referral                                         */
/* ------------------------------------------------------------------ */
router.get(
  '/me/referral',
  asyncRoute(async (req, res) => {
    const link = buildReferralLink(req.partner.signup_url_template, req.partner.referral_code);
    const [stats, qr] = await Promise.all([
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ?) AS signups,
           (SELECT COUNT(*) FROM referral_clicks WHERE partner_id = ?) AS clicks,
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ? AND status = 'active') AS converted`,
        [req.partner.id, req.partner.id, req.partner.id],
      ),
      qrDataUrl(link, 360),
    ]);

    const clicks = Number(stats.clicks);
    const signups = Number(stats.signups);
    return ok(res, {
      referral_code: req.partner.referral_code,
      referral_link: link,
      qr_data_url: qr,
      qr_download_url: '/api/v1/individual/me/referral/qr.png',
      signups,
      clicks,
      purchasing_referrals: Number(stats.converted),
      conversion_rate: clicks > 0 ? Math.round((signups / clicks) * 1000) / 10 : 0,
      share_message: `Get instant mobile data wherever you travel with The Travela. Sign up with my link: ${link}`,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/referral/qr.png - 1000x1000 print download       */
/* ------------------------------------------------------------------ */
router.get(
  '/me/referral/qr.png',
  asyncRoute(async (req, res) => {
    const link = buildReferralLink(req.partner.signup_url_template, req.partner.referral_code);
    const png = await qrPngBuffer(link, 1000);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pazo-${req.partner.referral_code}-qr.png"`,
    );
    return res.send(png);
  }),
);

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
router.get(
  '/me/notifications',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count, unread] = await Promise.all([
      query(
        `SELECT id, type, title, message, data, is_read, created_at
           FROM notifications WHERE user_id = ?
          ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [req.user.id]),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [
        req.user.id,
      ]),
    ]);
    return ok(res, {
      ...paged(
        rows.map((r) => ({ ...r, is_read: !!r.is_read })),
        Number(count.n),
        page,
        limit,
      ),
      unread: Number(unread.n),
    });
  }),
);

router.put(
  '/me/notifications/:id/read',
  asyncRoute(async (req, res) => {
    const result = await execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id],
    );
    if (!result.affectedRows) throw notFound('Notification not found');
    return ok(res, { read: true });
  }),
);

router.put(
  '/me/notifications/read-all',
  asyncRoute(async (req, res) => {
    const result = await execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id],
    );
    return ok(res, { marked: result.affectedRows });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /individual/me/earnings-chart - last 30 days                    */
/* ------------------------------------------------------------------ */
router.get(
  '/me/earnings-chart',
  asyncRoute(async (req, res) => {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const rows = await query(
      `SELECT DATE(created_at) AS day, COALESCE(SUM(commission_tzs),0) AS total
         FROM transactions
        WHERE partner_id = ? AND commission_status = 'paid'
          AND created_at >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
        GROUP BY DATE(created_at) ORDER BY day ASC`,
      [req.partner.id, days],
    );
    return ok(res, {
      days,
      series: fillDays(rows, days),
    });
  }),
);

/** Fill missing days with zero so charts have a continuous axis. */
export function fillDays(rows, days) {
  const map = new Map(
    rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.total)]),
  );
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, value: map.get(d) || 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* DELETE /individual/me - right to deletion (spec 8.3)                */
/* ------------------------------------------------------------------ */
router.delete(
  '/me',
  asyncRoute(async (req, res) => {
    const profile = await queryOne(
      'SELECT wallet_balance_tzs FROM individual_profiles WHERE user_id = ?',
      [req.user.id],
    );
    if (Number(profile.wallet_balance_tzs) > 0)
      throw badRequest('Withdraw your remaining balance before closing your account');

    await execute("UPDATE users SET status = 'deactivated' WHERE id = ?", [req.user.id]);
    await execute("UPDATE partners SET status = 'inactive' WHERE user_id = ?", [req.user.id]);
    await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [req.user.id]);
    await recordAudit({
      actor: req.user,
      action: 'individual.account_closed',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, {
      closed: true,
      message:
        'Your account is closed. Personal details are removed within 30 days; transaction records are kept for audit.',
    });
  }),
);

export default router;
