import express from 'express';
import { execute, query, queryOne } from '../db/pool.js';
import { asyncRoute, badRequest, conflict, notFound, ok, pagination, paged } from '../utils/http.js';
import {
  buildReferralLink,
  displayPhone,
  isEmail,
  maskAccount,
  maskPhone,
  monthStart,
  nextMonthStart,
  normalisePhone,
} from '../utils/format.js';
import { requireAuth, requireRole, loadPartner } from '../middleware/auth.js';
import { qrDataUrl, qrPngBuffer } from '../services/qr.js';
import { getSetting } from '../services/settings.js';
import { recordAudit, clientIp } from '../services/audit.js';
import { buildStatementHtml } from '../services/statements.js';
import { fillDays } from './individual.js';

const router = express.Router();
router.use(requireAuth, requireRole('institution'), loadPartner);

const maskPayout = (profile) =>
  profile.payout_method === 'mobile_money'
    ? maskPhone(profile.payout_account)
    : maskAccount(profile.payout_account);

/* ------------------------------------------------------------------ */
/* GET /institution/me                                                 */
/* ------------------------------------------------------------------ */
router.get(
  '/me',
  asyncRoute(async (req, res) => {
    const profile = await queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [
      req.user.id,
    ]);
    return ok(res, {
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        avatar_color: req.user.avatar_color,
        member_since: req.user.created_at,
      },
      profile: {
        organisation_name: profile.organisation_name,
        industry_type: profile.industry_type,
        contact_person_name: profile.contact_person_name,
        contact_phone: profile.contact_phone,
        contact_phone_display: displayPhone(profile.contact_phone),
        payout_method: profile.payout_method,
        payout_bank_name: profile.payout_bank_name,
        payout_account_masked: maskPayout(profile),
        payout_account_verified: !!profile.payout_account_verified,
        accumulated_balance_tzs: Number(profile.accumulated_balance_tzs),
        lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
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
      next_payout_date: nextMonthStart(),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* PUT /institution/me                                                 */
/* ------------------------------------------------------------------ */
router.put(
  '/me',
  asyncRoute(async (req, res) => {
    const { organisation_name, contact_person_name, contact_phone, email, industry_type } =
      req.body || {};

    if (organisation_name !== undefined) {
      const name = String(organisation_name).trim();
      if (name.length < 2) throw badRequest('Enter your organisation name');
      await execute('UPDATE institution_profiles SET organisation_name = ? WHERE user_id = ?', [
        name,
        req.user.id,
      ]);
      await execute('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
    }
    if (contact_person_name !== undefined) {
      await execute('UPDATE institution_profiles SET contact_person_name = ? WHERE user_id = ?', [
        String(contact_person_name).trim(),
        req.user.id,
      ]);
    }
    if (industry_type !== undefined) {
      await execute('UPDATE institution_profiles SET industry_type = ? WHERE user_id = ?', [
        industry_type || null,
        req.user.id,
      ]);
    }
    if (contact_phone !== undefined) {
      const clean = normalisePhone(contact_phone);
      if (!clean) throw badRequest('Enter a valid Tanzanian phone number');
      await execute('UPDATE institution_profiles SET contact_phone = ? WHERE user_id = ?', [
        clean,
        req.user.id,
      ]);
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
    }

    return ok(res, { updated: true });
  }),
);

/**
 * Payout account changes are requested, not applied directly: Pazo verifies the
 * destination before money moves there. The request lands in the admin queue as
 * an audit entry and the account is marked unverified until admin confirms.
 */
router.post(
  '/me/payout-request',
  asyncRoute(async (req, res) => {
    const { payout_method, payout_account, payout_bank_name } = req.body || {};
    if (!['bank', 'mobile_money'].includes(payout_method))
      throw badRequest('Choose a bank account or mobile money');
    if (!payout_account || String(payout_account).trim().length < 5)
      throw badRequest('Enter the full account details');

    const account =
      payout_method === 'mobile_money'
        ? normalisePhone(payout_account)
        : String(payout_account).trim();
    if (!account) throw badRequest('Enter a valid mobile money number');

    await execute(
      `UPDATE institution_profiles
          SET payout_method = ?, payout_account = ?, payout_bank_name = ?, payout_account_verified = 0
        WHERE user_id = ?`,
      [payout_method, account, payout_bank_name || null, req.user.id],
    );
    await recordAudit({
      actor: req.user,
      action: 'institution.payout_change_requested',
      resourceType: 'user',
      resourceId: req.user.id,
      detail: { payout_method },
      ip: clientIp(req),
    });

    return ok(res, {
      submitted: true,
      message: 'Pazo will verify the new payout account before your next payout.',
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /institution/me/home                                            */
/* ------------------------------------------------------------------ */
router.get(
  '/me/home',
  asyncRoute(async (req, res) => {
    const [profile, stats, lastPayout, unread, announcement] = await Promise.all([
      queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [req.user.id]),
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ?) AS total_referrals,
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS referrals_this_month,
           (SELECT COUNT(*) FROM referral_clicks WHERE partner_id = ?) AS total_clicks,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions
             WHERE partner_id = ? AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS sales_this_month,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
             WHERE partner_id = ? AND commission_status = 'pending') AS pending_tzs`,
        [req.partner.id, req.partner.id, req.partner.id, req.partner.id, req.partner.id],
      ),
      queryOne(
        `SELECT payout_month, amount_tzs, status, completed_at FROM institution_payouts
          WHERE partner_id = ? AND status = 'completed'
          ORDER BY payout_month DESC LIMIT 1`,
        [req.partner.id],
      ),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [
        req.user.id,
      ]),
      queryOne(
        `SELECT id, title, body, variant FROM announcements
          WHERE active = 1 AND audience IN ('all','institutions')
            AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
            AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP())
          ORDER BY created_at DESC LIMIT 1`,
      ),
    ]);

    const recent = await query(
      `SELECT id, bundle_type, transaction_type, commission_tzs, commission_status, created_at
         FROM transactions
        WHERE partner_id = ? AND commission_tzs > 0
        ORDER BY created_at DESC LIMIT 8`,
      [req.partner.id],
    );

    return ok(res, {
      organisation_name: profile.organisation_name,
      accumulated_balance_tzs: Number(profile.accumulated_balance_tzs),
      lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
      pending_tzs: Number(stats.pending_tzs),
      total_referrals: Number(stats.total_referrals),
      referrals_this_month: Number(stats.referrals_this_month),
      total_clicks: Number(stats.total_clicks),
      sales_this_month_tzs: Number(stats.sales_this_month),
      next_payout_date: nextMonthStart(),
      last_payout: lastPayout
        ? {
            month: lastPayout.payout_month,
            amount_tzs: Number(lastPayout.amount_tzs),
            completed_at: lastPayout.completed_at,
          }
        : null,
      referral_code: req.partner.referral_code,
      referral_link: buildReferralLink(req.partner.signup_url_template, req.partner.referral_code),
      payout_account_masked: maskPayout(profile),
      unread_notifications: Number(unread.n),
      announcement: announcement || null,
      recent_commissions: recent.map((r) => ({
        id: r.id,
        bundle_type: r.bundle_type,
        transaction_type: r.transaction_type,
        commission_tzs: Number(r.commission_tzs),
        status: r.commission_status,
        created_at: r.created_at,
      })),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /institution/me/wallet                                          */
/* ------------------------------------------------------------------ */
router.get(
  '/me/wallet',
  asyncRoute(async (req, res) => {
    const profile = await queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [
      req.user.id,
    ]);
    const payoutDay = await getSetting('institution_payout_day', 1);
    const monthToDate = await queryOne(
      `SELECT COALESCE(SUM(commission_tzs),0) AS earned, COUNT(*) AS n
         FROM transactions
        WHERE partner_id = ? AND commission_status = 'paid'
          AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
      [req.partner.id],
    );

    return ok(res, {
      accumulated_balance_tzs: Number(profile.accumulated_balance_tzs),
      lifetime_earned_tzs: Number(profile.lifetime_earned_tzs),
      earned_this_month_tzs: Number(monthToDate.earned),
      transactions_this_month: Number(monthToDate.n),
      next_payout_date: nextMonthStart(),
      payout_day: Number(payoutDay),
      payout_account_masked: maskPayout(profile),
      payout_account_verified: !!profile.payout_account_verified,
      payout_method: profile.payout_method,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /institution/me/transactions                                    */
/* ------------------------------------------------------------------ */
router.get(
  '/me/transactions',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = ['partner_id = ?', 'commission_tzs > 0'];
    const params = [req.partner.id];
    if (req.query.month) {
      where.push("DATE_FORMAT(created_at, '%Y-%m') = ?");
      params.push(String(req.query.month).slice(0, 7));
    }
    const whereSql = where.join(' AND ');

    const [rows, count] = await Promise.all([
      query(
        `SELECT id, bundle_type, transaction_type, commission_tzs, amount_tzs, commission_status, created_at
           FROM transactions WHERE ${whereSql}
          ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM transactions WHERE ${whereSql}`, params),
    ]);

    return ok(
      res,
      paged(
        rows.map((r) => ({
          id: r.id,
          bundle_type: r.bundle_type,
          transaction_type: r.transaction_type,
          commission_tzs: Number(r.commission_tzs),
          sale_tzs: Number(r.amount_tzs),
          status: r.commission_status,
          created_at: r.created_at,
        })),
        Number(count.n),
        page,
        limit,
      ),
    );
  }),
);

/* ------------------------------------------------------------------ */
/* GET /institution/me/payouts - monthly payout table (spec 3.3)       */
/* ------------------------------------------------------------------ */
router.get(
  '/me/payouts',
  asyncRoute(async (req, res) => {
    const rows = await query(
      `SELECT id, payout_month, amount_tzs, transaction_count, referral_count, sales_total_tzs,
              status, reference, processed_at, completed_at
         FROM institution_payouts WHERE partner_id = ?
        ORDER BY payout_month DESC`,
      [req.partner.id],
    );

    const profile = await queryOne(
      'SELECT accumulated_balance_tzs FROM institution_profiles WHERE user_id = ?',
      [req.user.id],
    );

    // The current month is shown as an upcoming row so the table always
    // answers "when do I next get paid?".
    const currentMonth = monthStart();
    const alreadyListed = rows.some(
      (r) => new Date(r.payout_month).toISOString().slice(0, 10) === currentMonth,
    );
    const thisMonth = await queryOne(
      `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount_tzs),0) AS sales,
              COALESCE(SUM(commission_tzs),0) AS commission
         FROM transactions
        WHERE partner_id = ? AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
      [req.partner.id],
    );
    const referralsThisMonth = await queryOne(
      `SELECT COUNT(*) AS n FROM referrals
        WHERE partner_id = ? AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
      [req.partner.id],
    );

    const items = rows.map((r) => ({
      id: r.id,
      month: r.payout_month,
      referrals: Number(r.referral_count),
      sales_tzs: Number(r.sales_total_tzs),
      commission_tzs: Number(r.amount_tzs),
      transaction_count: Number(r.transaction_count),
      status: r.status,
      reference: r.reference,
      paid_at: r.completed_at || r.processed_at,
      statement_url: `/api/v1/institution/me/statements/${new Date(r.payout_month)
        .toISOString()
        .slice(0, 7)}`,
      upcoming: false,
    }));

    if (!alreadyListed) {
      items.unshift({
        id: 'upcoming',
        month: currentMonth,
        referrals: Number(referralsThisMonth.n),
        sales_tzs: Number(thisMonth.sales),
        commission_tzs: Number(profile.accumulated_balance_tzs),
        transaction_count: Number(thisMonth.tx_count),
        status: 'upcoming',
        reference: null,
        paid_at: null,
        expected_at: nextMonthStart(),
        statement_url: null,
        upcoming: true,
      });
    }

    return ok(res, { items, next_payout_date: nextMonthStart() });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /institution/me/statements/:month - printable statement         */
/* ------------------------------------------------------------------ */
router.get(
  '/me/statements/:month',
  asyncRoute(async (req, res) => {
    const month = String(req.params.month).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Use a month in YYYY-MM format');

    const profile = await queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [
      req.user.id,
    ]);
    const rows = await query(
      `SELECT bundle_type, transaction_type, amount_tzs, commission_tzs, commission_status, created_at
         FROM transactions
        WHERE partner_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?
        ORDER BY created_at ASC`,
      [req.partner.id, month],
    );
    if (!rows.length) throw notFound('There is no activity for that month');

    const payout = await queryOne(
      "SELECT * FROM institution_payouts WHERE partner_id = ? AND DATE_FORMAT(payout_month, '%Y-%m') = ? LIMIT 1",
      [req.partner.id, month],
    );

    const html = buildStatementHtml({
      month,
      organisation: profile.organisation_name,
      referralCode: req.partner.referral_code,
      businessName: req.partner.business_name,
      payoutAccount: maskPayout(profile),
      rows,
      payout,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="pazo-statement-${month}.html"`);
    return res.send(html);
  }),
);

/* ------------------------------------------------------------------ */
/* Referral, notifications, chart - same contract as individual        */
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
      qr_download_url: '/api/v1/institution/me/referral/qr.png',
      signups,
      clicks,
      purchasing_referrals: Number(stats.converted),
      conversion_rate: clicks > 0 ? Math.round((signups / clicks) * 1000) / 10 : 0,
      share_message: `Travelling? Get instant mobile data with The Travela: ${link}`,
    });
  }),
);

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
    return ok(res, { days, series: fillDays(rows, days) });
  }),
);

export default router;
