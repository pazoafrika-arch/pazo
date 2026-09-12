import express from 'express';
import { execute, query, queryOne, transaction } from '../db/pool.js';
import {
  asyncRoute,
  badRequest,
  conflict,
  notFound,
  ok,
  pagination,
  paged,
} from '../utils/http.js';
import { generateApiKey, hashPassword, uuid, avatarColorFor } from '../utils/crypto.js';
import {
  buildReferralLink,
  isEmail,
  maskAccount,
  maskPhone,
  passwordProblem,
  toMysqlDateTime,
} from '../utils/format.js';
import {
  requireAuth,
  requireRole,
  loadBusiness,
  requireBusinessWrite,
} from '../middleware/auth.js';
import { recordAudit, clientIp } from '../services/audit.js';
import { settlePendingForBusiness } from '../services/commissions.js';
import { startWalletTopup } from '../services/payments.js';
import { isConfigured as gatewayConfigured } from '../services/clickpesa.js';
import { notify } from '../services/notifications.js';
import { fillDays } from './individual.js';
import { toCsv } from '../utils/csv.js';

const router = express.Router();
router.use(requireAuth, requireRole('business_owner'), loadBusiness);

/* ------------------------------------------------------------------ */
/* GET /business/me/overview (spec 4.2)                                */
/* ------------------------------------------------------------------ */
router.get(
  '/me/overview',
  asyncRoute(async (req, res) => {
    const b = req.business.id;

    const [current, previous, salesSeries, topPartners] = await Promise.all([
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM partners WHERE business_id = ? AND status = 'active') AS active_partners,
           (SELECT COUNT(*) FROM referrals WHERE business_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS referrals_month,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions WHERE business_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS sales_month,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE business_id = ?
             AND commission_status = 'paid'
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS commissions_month,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE business_id = ?
             AND commission_status = 'pending') AS pending_commissions,
           (SELECT COUNT(*) FROM transactions WHERE business_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS tx_month`,
        [b, b, b, b, b, b],
      ),
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM partners WHERE business_id = ? AND status = 'active'
             AND created_at < (UTC_TIMESTAMP() - INTERVAL 30 DAY)) AS active_partners,
           (SELECT COUNT(*) FROM referrals WHERE business_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 1 MONTH, '%Y-%m-01')
             AND created_at <  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS referrals_month,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions WHERE business_id = ?
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 1 MONTH, '%Y-%m-01')
             AND created_at <  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS sales_month,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE business_id = ?
             AND commission_status = 'paid'
             AND created_at >= DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 1 MONTH, '%Y-%m-01')
             AND created_at <  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS commissions_month`,
        [b, b, b, b],
      ),
      query(
        `SELECT DATE(created_at) AS day, COALESCE(SUM(amount_tzs),0) AS total
           FROM transactions
          WHERE business_id = ? AND created_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)
          GROUP BY DATE(created_at) ORDER BY day ASC`,
        [b],
      ),
      query(
        `SELECT p.id, p.referral_code, p.partner_type, u.name,
                COALESCE(SUM(t.commission_tzs),0) AS commission_tzs,
                COUNT(t.id) AS tx_count
           FROM partners p
           JOIN users u ON u.id = p.user_id
           LEFT JOIN transactions t
             ON t.partner_id = p.id
            AND t.created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
          WHERE p.business_id = ?
          GROUP BY p.id, p.referral_code, p.partner_type, u.name
          ORDER BY commission_tzs DESC LIMIT 5`,
        [b],
      ),
    ]);

    const pct = (now, before) => {
      const a = Number(now);
      const bfr = Number(before);
      if (!bfr) return a > 0 ? 100 : 0;
      return Math.round(((a - bfr) / bfr) * 1000) / 10;
    };

    const balance = Number(req.business.wallet_balance_tzs);
    const threshold = Number(req.business.wallet_alert_threshold_tzs);

    return ok(res, {
      business: {
        name: req.business.name,
        website: req.business.website,
        commission_rate: Number(req.business.commission_rate),
        platform_fee_rate: Number(req.business.platform_fee_rate),
      },
      cards: {
        active_partners: {
          value: Number(current.active_partners),
          change_pct: pct(current.active_partners, previous.active_partners),
        },
        referrals_this_month: {
          value: Number(current.referrals_month),
          change_pct: pct(current.referrals_month, previous.referrals_month),
        },
        sales_this_month_tzs: {
          value: Number(current.sales_month),
          change_pct: pct(current.sales_month, previous.sales_month),
        },
        commissions_this_month_tzs: {
          value: Number(current.commissions_month),
          change_pct: pct(current.commissions_month, previous.commissions_month),
        },
      },
      wallet: {
        balance_tzs: balance,
        alert_threshold_tzs: threshold,
        low_balance: balance < threshold,
        pending_commissions_tzs: Number(current.pending_commissions),
      },
      transactions_this_month: Number(current.tx_month),
      daily_sales: fillDays(salesSeries, 30),
      top_partners: topPartners.map((p) => ({
        id: p.id,
        name: p.name,
        referral_code: p.referral_code,
        partner_type: p.partner_type,
        commission_tzs: Number(p.commission_tzs),
        transactions: Number(p.tx_count),
      })),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/partners (spec 4.3)                                */
/* ------------------------------------------------------------------ */
const PARTNER_SORTS = {
  name: 'u.name',
  referrals_month: 'referrals_month',
  total_referrals: 'p.total_referrals',
  sales_tzs: 'sales_tzs',
  commission_tzs: 'commission_tzs',
  created_at: 'p.created_at',
};

router.get(
  '/me/partners',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = ['p.business_id = ?'];
    const params = [req.business.id];

    if (req.query.type && ['individual', 'institution'].includes(req.query.type)) {
      where.push('p.partner_type = ?');
      params.push(req.query.type);
    }
    if (req.query.status && ['active', 'suspended', 'inactive'].includes(req.query.status)) {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR p.referral_code LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like);
    }
    const whereSql = where.join(' AND ');

    const sortKey = PARTNER_SORTS[req.query.sort] || 'commission_tzs';
    const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const rows = await query(
      `SELECT p.id, p.referral_code, p.partner_type, p.status, p.total_referrals,
              p.total_earnings_tzs, p.created_at, p.last_active_at,
              u.id AS user_id, u.name, u.email, u.phone, u.avatar_color, u.has_avatar,
              COALESCE(m.referrals_month, 0) AS referrals_month,
              COALESCE(s.sales_tzs, 0)       AS sales_tzs,
              COALESCE(s.commission_tzs, 0)  AS commission_tzs
         FROM partners p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN (
           SELECT partner_id, COUNT(*) AS referrals_month FROM referrals
            WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
            GROUP BY partner_id
         ) m ON m.partner_id = p.id
         LEFT JOIN (
           SELECT partner_id, SUM(amount_tzs) AS sales_tzs, SUM(commission_tzs) AS commission_tzs
             FROM transactions
            WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
            GROUP BY partner_id
         ) s ON s.partner_id = p.id
        WHERE ${whereSql}
        ORDER BY ${sortKey} ${dir}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const count = await queryOne(
      `SELECT COUNT(*) AS n FROM partners p JOIN users u ON u.id = p.user_id WHERE ${whereSql}`,
      params,
    );

    const items = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      name: r.name,
      avatar_color: r.avatar_color,
      has_avatar: !!r.has_avatar,
      partner_type: r.partner_type,
      referral_code: r.referral_code,
      referrals_this_month: Number(r.referrals_month),
      total_referrals: Number(r.total_referrals),
      sales_tzs: Number(r.sales_tzs),
      commission_tzs: Number(r.commission_tzs),
      total_earnings_tzs: Number(r.total_earnings_tzs),
      payout_method: r.partner_type === 'individual' ? 'Instant' : 'Monthly',
      status: r.status,
      joined_at: r.created_at,
      last_active_at: r.last_active_at,
    }));

    if (req.query.format === 'csv') {
      return sendCsv(res, 'pazo-partners', items);
    }
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/partners/:id - detail side panel                   */
/* ------------------------------------------------------------------ */
router.get(
  '/me/partners/:id',
  asyncRoute(async (req, res) => {
    const partner = await queryOne(
      `SELECT p.*, u.name, u.email, u.phone, u.avatar_color, u.has_avatar,
              u.created_at AS joined_at, u.status AS user_status
         FROM partners p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.business_id = ? LIMIT 1`,
      [req.params.id, req.business.id],
    );
    if (!partner) throw notFound('Partner not found');

    const [stats, commissions, payouts, profile] = await Promise.all([
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ?) AS referrals,
           (SELECT COUNT(*) FROM referrals WHERE partner_id = ? AND status = 'active') AS converted,
           (SELECT COUNT(*) FROM referral_clicks WHERE partner_id = ?) AS clicks,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions WHERE partner_id = ?) AS sales,
           (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
             WHERE partner_id = ? AND commission_status = 'pending') AS pending`,
        [partner.id, partner.id, partner.id, partner.id, partner.id],
      ),
      query(
        `SELECT id, bundle_type, transaction_type, amount_tzs, commission_tzs,
                commission_status, created_at
           FROM transactions WHERE partner_id = ?
          ORDER BY created_at DESC LIMIT 25`,
        [partner.id],
      ),
      partner.partner_type === 'institution'
        ? query(
            `SELECT payout_month, amount_tzs, status, completed_at, reference
               FROM institution_payouts WHERE partner_id = ?
              ORDER BY payout_month DESC LIMIT 12`,
            [partner.id],
          )
        : query(
            `SELECT id, amount_tzs, status, requested_at, completed_at, mobile_money_number
               FROM withdrawals WHERE partner_id = ?
              ORDER BY requested_at DESC LIMIT 12`,
            [partner.id],
          ),
      partner.partner_type === 'institution'
        ? queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [partner.user_id])
        : queryOne('SELECT * FROM individual_profiles WHERE user_id = ?', [partner.user_id]),
    ]);

    const link = buildReferralLink(req.business.signup_url_template, partner.referral_code);
    const clicks = Number(stats.clicks);
    const referrals = Number(stats.referrals);

    return ok(res, {
      partner: {
        id: partner.id,
        user_id: partner.user_id,
        name: partner.name,
        avatar_color: partner.avatar_color,
        has_avatar: !!partner.has_avatar,
        email: partner.email,
        phone: partner.phone ? maskPhone(partner.phone) : null,
        partner_type: partner.partner_type,
        referral_code: partner.referral_code,
        referral_link: link,
        status: partner.status,
        joined_at: partner.joined_at,
        last_active_at: partner.last_active_at,
        commission_rate: Number(partner.commission_rate_override ?? req.business.commission_rate),
        has_custom_rate: partner.commission_rate_override !== null,
      },
      profile:
        partner.partner_type === 'institution'
          ? {
              organisation_name: profile?.organisation_name,
              industry_type: profile?.industry_type,
              contact_person_name: profile?.contact_person_name,
              payout_account_masked: profile
                ? profile.payout_method === 'mobile_money'
                  ? maskPhone(profile.payout_account)
                  : maskAccount(profile.payout_account)
                : null,
              accumulated_balance_tzs: Number(profile?.accumulated_balance_tzs || 0),
            }
          : {
              wallet_balance_tzs: Number(profile?.wallet_balance_tzs || 0),
              mobile_money_masked: maskPhone(profile?.mobile_money_number),
              lifetime_withdrawn_tzs: Number(profile?.lifetime_withdrawn_tzs || 0),
            },
      stats: {
        referrals,
        converted: Number(stats.converted),
        clicks,
        conversion_rate: clicks > 0 ? Math.round((referrals / clicks) * 1000) / 10 : 0,
        sales_tzs: Number(stats.sales),
        earnings_tzs: Number(partner.total_earnings_tzs),
        pending_tzs: Number(stats.pending),
      },
      commissions: commissions.map((c) => ({
        id: c.id,
        bundle_type: c.bundle_type,
        transaction_type: c.transaction_type,
        amount_tzs: Number(c.amount_tzs),
        commission_tzs: Number(c.commission_tzs),
        status: c.commission_status,
        created_at: c.created_at,
      })),
      payouts: payouts.map((p) => ({
        ...p,
        amount_tzs: Number(p.amount_tzs),
        mobile_money_number: p.mobile_money_number ? maskPhone(p.mobile_money_number) : undefined,
      })),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* PUT /business/me/partners/:id/status                                */
/* ------------------------------------------------------------------ */
router.put(
  '/me/partners/:id/status',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const status = req.body?.status;
    if (!['active', 'suspended', 'inactive'].includes(status))
      throw badRequest('Choose active, suspended or inactive');

    const partner = await queryOne(
      'SELECT p.*, u.name FROM partners p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.business_id = ?',
      [req.params.id, req.business.id],
    );
    if (!partner) throw notFound('Partner not found');

    await execute('UPDATE partners SET status = ? WHERE id = ?', [status, partner.id]);
    await recordAudit({
      actor: req.user,
      action: `business.partner_${status}`,
      resourceType: 'partner',
      resourceId: partner.id,
      detail: { name: partner.name, status },
      ip: clientIp(req),
    });

    return ok(res, { updated: true, status });
  }),
);

/* ------------------------------------------------------------------ */
/* PUT /business/me/partners/:id/commission-rate                       */
/* ------------------------------------------------------------------ */
router.put(
  '/me/partners/:id/commission-rate',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const raw = req.body?.commission_rate;
    const rate = raw === null || raw === '' ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 0.5))
      throw badRequest('Enter a commission rate between 0% and 50%');

    const partner = await queryOne(
      'SELECT id FROM partners WHERE id = ? AND business_id = ?',
      [req.params.id, req.business.id],
    );
    if (!partner) throw notFound('Partner not found');

    await execute('UPDATE partners SET commission_rate_override = ? WHERE id = ?', [
      rate,
      partner.id,
    ]);
    await recordAudit({
      actor: req.user,
      action: 'business.partner_rate_changed',
      resourceType: 'partner',
      resourceId: partner.id,
      detail: { commission_rate: rate },
      ip: clientIp(req),
    });
    return ok(res, { updated: true, commission_rate: rate });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/referrals (spec 4.4) - anonymised                  */
/* ------------------------------------------------------------------ */
router.get(
  '/me/referrals',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = ['r.business_id = ?'];
    const params = [req.business.id];

    if (req.query.status && ['referred', 'active', 'inactive'].includes(req.query.status)) {
      where.push('r.status = ?');
      params.push(req.query.status);
    }
    if (req.query.partner_id) {
      where.push('r.partner_id = ?');
      params.push(req.query.partner_id);
    }
    if (req.query.q) {
      where.push('(r.tourist_external_id LIKE ? OR u.name LIKE ? OR p.referral_code LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const whereSql = where.join(' AND ');

    const [rows, count] = await Promise.all([
      query(
        `SELECT r.id, r.tourist_external_id, r.signup_date, r.first_purchase_date,
                r.total_purchases, r.total_value_tzs, r.status,
                u.name AS partner_name, p.referral_code, p.partner_type
           FROM referrals r
           JOIN partners p ON p.id = r.partner_id
           JOIN users u ON u.id = p.user_id
          WHERE ${whereSql}
          ORDER BY r.signup_date DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM referrals r
           JOIN partners p ON p.id = r.partner_id
           JOIN users u ON u.id = p.user_id
          WHERE ${whereSql}`,
        params,
      ),
    ]);

    // Only the opaque external ID is ever exposed - never a name or email.
    const items = rows.map((r) => ({
      id: r.id,
      customer_id: r.tourist_external_id,
      partner_name: r.partner_name,
      referral_code: r.referral_code,
      partner_type: r.partner_type,
      signup_date: r.signup_date,
      first_purchase_date: r.first_purchase_date,
      total_purchases: Number(r.total_purchases),
      total_value_tzs: Number(r.total_value_tzs),
      status: r.status,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-referrals', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/commissions (spec 4.5)                             */
/* ------------------------------------------------------------------ */
router.get(
  '/me/commissions',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = ['t.business_id = ?'];
    const params = [req.business.id];

    if (req.query.status && ['paid', 'pending', 'failed', 'resolved'].includes(req.query.status)) {
      where.push('t.commission_status = ?');
      params.push(req.query.status);
    }
    if (req.query.type && ['first_purchase', 'topup'].includes(req.query.type)) {
      where.push('t.transaction_type = ?');
      params.push(req.query.type);
    }
    if (req.query.partner_id) {
      where.push('t.partner_id = ?');
      params.push(req.query.partner_id);
    }
    if (req.query.from) {
      where.push('t.created_at >= ?');
      params.push(toMysqlDateTime(`${String(req.query.from).slice(0, 10)}T00:00:00Z`));
    }
    if (req.query.to) {
      where.push('t.created_at <= ?');
      params.push(toMysqlDateTime(`${String(req.query.to).slice(0, 10)}T23:59:59Z`));
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR p.referral_code LIKE ? OR t.external_tx_ref LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const whereSql = where.join(' AND ');

    const [rows, count, totals] = await Promise.all([
      query(
        `SELECT t.id, t.created_at, t.bundle_type, t.transaction_type, t.amount_tzs,
                t.commission_tzs, t.platform_fee_tzs, t.commission_status, t.external_tx_ref,
                u.name AS partner_name, p.referral_code
           FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
          WHERE ${whereSql}
          ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
          WHERE ${whereSql}`,
        params,
      ),
      queryOne(
        `SELECT COALESCE(SUM(t.amount_tzs),0) AS sales,
                COALESCE(SUM(t.commission_tzs),0) AS commission,
                COALESCE(SUM(t.platform_fee_tzs),0) AS fees
           FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
          WHERE ${whereSql}`,
        params,
      ),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      partner_name: r.partner_name || 'No partner',
      referral_code: r.referral_code,
      transaction_type: r.transaction_type,
      bundle_type: r.bundle_type,
      amount_tzs: Number(r.amount_tzs),
      commission_tzs: Number(r.commission_tzs),
      platform_fee_tzs: Number(r.platform_fee_tzs),
      status: r.commission_status,
      reference: r.external_tx_ref,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-commissions', items);

    return ok(res, {
      ...paged(items, Number(count.n), page, limit),
      totals: {
        sales_tzs: Number(totals.sales),
        commission_tzs: Number(totals.commission),
        platform_fee_tzs: Number(totals.fees),
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/wallet (spec 4.6)                                  */
/* ------------------------------------------------------------------ */
router.get(
  '/me/wallet',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req, 25);
    const [ledger, count, pending] = await Promise.all([
      query(
        `SELECT id, entry_type, amount_tzs, balance_after_tzs, description, created_at
           FROM wallet_ledger WHERE business_id = ?
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [req.business.id, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM wallet_ledger WHERE business_id = ?', [req.business.id]),
      query(
        `SELECT t.id, t.commission_tzs, t.created_at, t.bundle_type,
                u.name AS partner_name, p.referral_code
           FROM transactions t
           JOIN partners p ON p.id = t.partner_id
           JOIN users u ON u.id = p.user_id
          WHERE t.business_id = ? AND t.commission_status = 'pending'
          ORDER BY t.created_at ASC LIMIT 50`,
        [req.business.id],
      ),
    ]);

    const balance = Number(req.business.wallet_balance_tzs);
    const threshold = Number(req.business.wallet_alert_threshold_tzs);
    const pendingTotal = pending.reduce((s, p) => s + Number(p.commission_tzs), 0);

    return ok(res, {
      balance_tzs: balance,
      alert_threshold_tzs: threshold,
      low_balance: balance < threshold,
      pending_total_tzs: pendingTotal,
      shortfall_tzs: Math.max(0, pendingTotal - balance),
      // Mobile money is instant when the gateway is live; the bank details stay
      // available as the fallback for large transfers.
      instant_topup_available: gatewayConfigured(),
      topup_instructions: {
        bank_name: 'CRDB Bank Tanzania',
        account_name: 'Pazo Technologies Limited',
        account_number: '0150 3947 2100',
        swift: 'CORUTZTZ',
        reference: `PAZO-${req.business.slug.toUpperCase()}`,
        note: 'Transfers are credited by the Pazo finance team within one business day of receipt.',
      },
      ledger: paged(
        ledger.map((l) => ({
          id: l.id,
          entry_type: l.entry_type,
          amount_tzs: Number(l.amount_tzs),
          balance_after_tzs: Number(l.balance_after_tzs),
          description: l.description,
          created_at: l.created_at,
        })),
        Number(count.n),
        page,
        limit,
      ),
      pending_commissions: pending.map((p) => ({
        id: p.id,
        partner_name: p.partner_name,
        referral_code: p.referral_code,
        bundle_type: p.bundle_type,
        commission_tzs: Number(p.commission_tzs),
        created_at: p.created_at,
      })),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* GET/PUT /business/me/settings (spec 4.7)                            */
/* ------------------------------------------------------------------ */
router.get(
  '/me/settings',
  asyncRoute(async (req, res) => {
    const members = await query(
      `SELECT bm.id, bm.access, bm.is_owner, u.id AS user_id, u.name, u.email,
              u.status, u.has_avatar, u.last_login_at
         FROM business_members bm JOIN users u ON u.id = bm.user_id
        WHERE bm.business_id = ? ORDER BY bm.is_owner DESC, u.name ASC`,
      [req.business.id],
    );

    return ok(res, {
      business: {
        name: req.business.name,
        website: req.business.website,
        commission_rate: Number(req.business.commission_rate),
        platform_fee_rate: Number(req.business.platform_fee_rate),
        wallet_alert_threshold_tzs: Number(req.business.wallet_alert_threshold_tzs),
        notification_email: req.business.notification_email,
        signup_url_template: req.business.signup_url_template,
      },
      api_key: {
        prefix: req.business.api_key_prefix,
        last_four: req.business.api_key_last_four,
        masked: req.business.api_key_prefix
          ? `${req.business.api_key_prefix}_${'•'.repeat(24)}${req.business.api_key_last_four}`
          : null,
        rotated_at: req.business.api_key_rotated_at,
        docs_url: '/api/v1/integrations/docs',
      },
      team: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        name: m.name,
        email: m.email,
        access: m.access,
        is_owner: !!m.is_owner,
        status: m.status,
        has_avatar: !!m.has_avatar,
        last_login_at: m.last_login_at,
      })),
      my_access: req.business.member_access,
    });
  }),
);

router.put(
  '/me/settings',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const { commission_rate, wallet_alert_threshold_tzs, notification_email, website } =
      req.body || {};
    const updates = [];
    const params = [];

    if (commission_rate !== undefined) {
      const rate = Number(commission_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 0.5)
        throw badRequest('Commission rate must be between 0% and 50%');
      updates.push('commission_rate = ?');
      params.push(rate);
    }
    if (wallet_alert_threshold_tzs !== undefined) {
      const th = Math.floor(Number(wallet_alert_threshold_tzs));
      if (!Number.isFinite(th) || th < 0) throw badRequest('Enter a valid alert threshold');
      updates.push('wallet_alert_threshold_tzs = ?');
      params.push(th);
    }
    if (notification_email !== undefined) {
      const mail = String(notification_email).trim().toLowerCase();
      if (mail && !isEmail(mail)) throw badRequest('Enter a valid notification email');
      updates.push('notification_email = ?');
      params.push(mail || null);
    }
    if (website !== undefined) {
      updates.push('website = ?');
      params.push(String(website).trim() || null);
    }
    if (!updates.length) throw badRequest('Nothing to update');

    params.push(req.business.id);
    await execute(`UPDATE businesses SET ${updates.join(', ')} WHERE id = ?`, params);
    await recordAudit({
      actor: req.user,
      action: 'business.settings_updated',
      resourceType: 'business',
      resourceId: req.business.id,
      detail: req.body,
      ip: clientIp(req),
    });

    return ok(res, { updated: true });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /business/me/api-key/regenerate                                */
/* ------------------------------------------------------------------ */
router.post(
  '/me/api-key/regenerate',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const { key, hash, prefix, lastFour } = generateApiKey();
    await execute(
      `UPDATE businesses
          SET api_key_hash = ?, api_key_prefix = ?, api_key_last_four = ?, api_key_rotated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [hash, prefix, lastFour, req.business.id],
    );
    await recordAudit({
      actor: req.user,
      action: 'business.api_key_regenerated',
      resourceType: 'business',
      resourceId: req.business.id,
      ip: clientIp(req),
    });

    // The plaintext key is shown exactly once, per spec 8.2.
    return ok(res, {
      api_key: key,
      warning: 'Copy this key now. It is shown once and cannot be retrieved again.',
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Team members                                                        */
/* ------------------------------------------------------------------ */
router.post(
  '/me/team',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    if (!req.business.is_owner) throw badRequest('Only the business owner can add team members');
    const { name, email, password, access = 'full' } = req.body || {};
    const clean = String(email || '').trim().toLowerCase();
    if (!name || String(name).trim().length < 2) throw badRequest('Enter the team member name');
    if (!isEmail(clean)) throw badRequest('Enter a valid email address');
    if (!['full', 'read_only'].includes(access)) throw badRequest('Choose full or read-only access');
    const pwProblem = passwordProblem(password);
    if (pwProblem) throw badRequest(pwProblem);

    const exists = await queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [clean]);
    if (exists) throw conflict('That email already has a Pazo account');

    const userId = uuid();
    await transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
         VALUES (?, ?, ?, 'business_owner', 'active', ?, ?, 1)`,
        [
          userId,
          clean,
          await hashPassword(password),
          String(name).trim(),
          avatarColorFor(userId),
        ],
      );
      await tx.exec(
        'INSERT INTO business_members (id, business_id, user_id, access, is_owner) VALUES (?, ?, ?, ?, 0)',
        [uuid(), req.business.id, userId, access],
      );
      await notify(
        {
          userId,
          type: 'custom',
          params: {
            title: 'Welcome to the dashboard',
            body: `You now have ${access === 'read_only' ? 'read-only' : 'full'} access to the ${req.business.name} partner dashboard.`,
          },
        },
        tx,
      );
    });

    await recordAudit({
      actor: req.user,
      action: 'business.team_member_added',
      resourceType: 'user',
      resourceId: userId,
      detail: { email: clean, access },
      ip: clientIp(req),
    });

    return ok(res, { added: true, user_id: userId }, 201);
  }),
);

router.put(
  '/me/team/:id',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    if (!req.business.is_owner) throw badRequest('Only the business owner can change team access');
    const { access } = req.body || {};
    if (!['full', 'read_only'].includes(access)) throw badRequest('Choose full or read-only access');

    const member = await queryOne(
      'SELECT * FROM business_members WHERE id = ? AND business_id = ?',
      [req.params.id, req.business.id],
    );
    if (!member) throw notFound('Team member not found');
    if (member.is_owner) throw badRequest('The owner always keeps full access');

    await execute('UPDATE business_members SET access = ? WHERE id = ?', [access, member.id]);
    return ok(res, { updated: true, access });
  }),
);

router.delete(
  '/me/team/:id',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    if (!req.business.is_owner) throw badRequest('Only the business owner can remove team members');
    const member = await queryOne(
      'SELECT * FROM business_members WHERE id = ? AND business_id = ?',
      [req.params.id, req.business.id],
    );
    if (!member) throw notFound('Team member not found');
    if (member.is_owner) throw badRequest('The business owner cannot be removed');

    await execute('DELETE FROM business_members WHERE id = ?', [member.id]);
    await execute("UPDATE users SET status = 'deactivated' WHERE id = ?", [member.user_id]);
    await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [member.user_id]);
    await recordAudit({
      actor: req.user,
      action: 'business.team_member_removed',
      resourceType: 'user',
      resourceId: member.user_id,
      ip: clientIp(req),
    });
    return ok(res, { removed: true });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /business/me/wallet/topup                                      */
/* Push a payment prompt to the payer's phone. The wallet is credited   */
/* only when ClickPesa confirms, never when the request is made.        */
/* ------------------------------------------------------------------ */
router.post(
  '/me/wallet/topup',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const result = await startWalletTopup({
      business: req.business,
      amountTzs: req.body?.amount_tzs,
      phoneNumber: req.body?.phone_number,
      actor: req.user,
    });
    return ok(res, result, 201);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /business/me/wallet/topups                                      */
/* ------------------------------------------------------------------ */
router.get(
  '/me/wallet/topups',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req, 15);
    const [rows, count] = await Promise.all([
      query(
        `SELECT id, order_reference, method, amount_tzs, phone_number, channel,
                status, failure_reason, credited_at, created_at
           FROM wallet_topups WHERE business_id = ?
          ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [req.business.id, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM wallet_topups WHERE business_id = ?', [req.business.id]),
    ]);

    return ok(
      res,
      paged(
        rows.map((r) => ({
          id: r.id,
          reference: r.order_reference,
          method: r.method,
          amount_tzs: Number(r.amount_tzs),
          destination: r.phone_number ? maskPhone(r.phone_number) : null,
          channel: r.channel,
          status: r.status,
          failure_reason: r.failure_reason,
          completed_at: r.credited_at,
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
/* POST /business/me/wallet/settle-pending                             */
/* ------------------------------------------------------------------ */
router.post(
  '/me/wallet/settle-pending',
  requireBusinessWrite,
  asyncRoute(async (req, res) => {
    const result = await settlePendingForBusiness(req.business.id, req.user.id);
    await recordAudit({
      actor: req.user,
      action: 'business.pending_settled',
      resourceType: 'business',
      resourceId: req.business.id,
      detail: result,
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/* ------------------------------------------------------------------ */
/* Notifications for the business team                                 */
/* ------------------------------------------------------------------ */
router.get(
  '/me/notifications',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count, unread] = await Promise.all([
      query(
        `SELECT id, type, title, message, data, is_read, created_at FROM notifications
          WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [req.user.id]),
      queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [
        req.user.id,
      ]),
    ]);
    return ok(res, {
      ...paged(rows.map((r) => ({ ...r, is_read: !!r.is_read })), Number(count.n), page, limit),
      unread: Number(unread.n),
    });
  }),
);

router.put(
  '/me/notifications/read-all',
  asyncRoute(async (req, res) => {
    const r = await execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id],
    );
    return ok(res, { marked: r.affectedRows });
  }),
);

function sendCsv(res, name, rows) {
  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return res.send(csv);
}

export default router;
