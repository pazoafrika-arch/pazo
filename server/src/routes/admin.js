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
import {
  avatarColorFor,
  generateApiKey,
  hashPassword,
  randomToken,
  uuid,
} from '../utils/crypto.js';
import {
  buildReferralLink,
  isEmail,
  isValidCode,
  maskAccount,
  maskPhone,
  monthStart,
  normaliseCode,
  normalisePhone,
  passwordProblem,
  slugify,
  toMysqlDateTime,
} from '../utils/format.js';
import { requireAuth, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { recordAudit, clientIp } from '../services/audit.js';
import { settlePendingForBusiness } from '../services/commissions.js';
import {
  completeWithdrawal,
  failWithdrawal,
  reconcileWithdrawal,
  submitWithdrawal,
  drainPayoutQueue,
} from '../services/payments.js';
import { getBalance, isConfigured as gatewayConfigured } from '../services/clickpesa.js';
import { notify, notifyMany, deliverExternal } from '../services/notifications.js';
import { allSettings, updateSettings } from '../services/settings.js';
import { toCsv } from '../utils/csv.js';
import { fillDays } from './individual.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'super_admin'));

const sendCsv = (res, name, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return res.send(toCsv(rows));
};

/* ================================================================== */
/* OVERVIEW (spec 5.2)                                                 */
/* ================================================================== */
router.get(
  '/overview',
  asyncRoute(async (req, res) => {
    const [counts, today, series, recentAudit] = await Promise.all([
      queryOne(
        `SELECT
          (SELECT COUNT(*) FROM businesses) AS businesses,
          (SELECT COUNT(*) FROM businesses WHERE status = 'active') AS businesses_active,
          (SELECT COUNT(*) FROM partners WHERE partner_type = 'individual') AS individuals,
          (SELECT COUNT(*) FROM partners WHERE partner_type = 'institution') AS institutions,
          (SELECT COUNT(*) FROM partners WHERE status = 'active') AS partners_active,
          (SELECT COUNT(*) FROM institution_applications WHERE status = 'pending') AS pending_approvals,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE commission_status = 'pending') AS pending_commissions,
          (SELECT COUNT(*) FROM transactions WHERE commission_status = 'pending') AS pending_count,
          (SELECT COALESCE(SUM(wallet_balance_tzs),0) FROM businesses) AS wallet_total,
          (SELECT COUNT(*) FROM referrals) AS referrals_total,
          (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions) AS gmv_total`,
      ),
      queryOne(
        `SELECT
          (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = UTC_DATE()) AS tx_today,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
            WHERE commission_status = 'paid' AND DATE(paid_at) = UTC_DATE()) AS commissions_today,
          (SELECT COALESCE(SUM(platform_fee_tzs),0) FROM transactions
            WHERE DATE(created_at) = UTC_DATE()) AS fees_today,
          (SELECT COALESCE(SUM(platform_fee_tzs),0) FROM transactions
            WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS fees_month,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
            WHERE commission_status = 'paid'
              AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS commissions_month`,
      ),
      query(
        `SELECT DATE(created_at) AS day,
                COALESCE(SUM(amount_tzs),0) AS sales,
                COALESCE(SUM(commission_tzs),0) AS commission,
                COALESCE(SUM(platform_fee_tzs),0) AS fees
           FROM transactions
          WHERE created_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)
          GROUP BY DATE(created_at) ORDER BY day ASC`,
      ),
      query(
        `SELECT actor_name, actor_role, action, resource_type, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT 8`,
      ),
    ]);

    const businesses = await query(
      `SELECT b.id, b.name, b.wallet_balance_tzs, b.wallet_alert_threshold_tzs, b.status,
              (SELECT COUNT(*) FROM partners WHERE business_id = b.id) AS partners
         FROM businesses b ORDER BY b.created_at ASC`,
    );

    return ok(res, {
      totals: {
        businesses: Number(counts.businesses),
        businesses_active: Number(counts.businesses_active),
        individual_partners: Number(counts.individuals),
        institution_partners: Number(counts.institutions),
        active_partners: Number(counts.partners_active),
        referrals: Number(counts.referrals_total),
        gmv_tzs: Number(counts.gmv_total),
        wallet_total_tzs: Number(counts.wallet_total),
      },
      today: {
        transactions: Number(today.tx_today),
        commissions_paid_tzs: Number(today.commissions_today),
        platform_fees_tzs: Number(today.fees_today),
      },
      this_month: {
        commissions_paid_tzs: Number(today.commissions_month),
        platform_fees_tzs: Number(today.fees_month),
      },
      attention: {
        pending_approvals: Number(counts.pending_approvals),
        pending_commissions_tzs: Number(counts.pending_commissions),
        pending_commission_count: Number(counts.pending_count),
        low_wallet_businesses: businesses
          .filter(
            (b) => Number(b.wallet_balance_tzs) < Number(b.wallet_alert_threshold_tzs),
          )
          .map((b) => ({
            id: b.id,
            name: b.name,
            balance_tzs: Number(b.wallet_balance_tzs),
            threshold_tzs: Number(b.wallet_alert_threshold_tzs),
          })),
      },
      chart: {
        sales: fillDays(series.map((s) => ({ day: s.day, total: s.sales })), 30),
        commissions: fillDays(series.map((s) => ({ day: s.day, total: s.commission })), 30),
        fees: fillDays(series.map((s) => ({ day: s.day, total: s.fees })), 30),
      },
      businesses: businesses.map((b) => ({
        id: b.id,
        name: b.name,
        wallet_balance_tzs: Number(b.wallet_balance_tzs),
        partners: Number(b.partners),
        status: b.status,
      })),
      recent_activity: recentAudit,
    });
  }),
);

/* ================================================================== */
/* BUSINESSES (spec 5.3)                                               */
/* ================================================================== */
router.get(
  '/businesses',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (req.query.status && ['active', 'suspended'].includes(req.query.status)) {
      where.push('b.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(b.name LIKE ? OR b.website LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT b.*,
                (SELECT COUNT(*) FROM partners WHERE business_id = b.id) AS partners,
                (SELECT COUNT(*) FROM partners WHERE business_id = b.id AND status='active') AS partners_active,
                (SELECT COUNT(*) FROM transactions WHERE business_id = b.id) AS transactions,
                (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions
                  WHERE business_id = b.id AND commission_status='paid') AS commissions_paid,
                (SELECT COALESCE(SUM(platform_fee_tzs),0) FROM transactions WHERE business_id = b.id) AS fees
           FROM businesses b ${whereSql}
          ORDER BY b.created_at ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM businesses b ${whereSql}`, params),
    ]);

    const items = rows.map((b) => ({
      id: b.id,
      name: b.name,
      website: b.website,
      category: b.category,
      status: b.status,
      api_key_status: b.api_key_hash ? 'active' : 'not_issued',
      api_key_masked: b.api_key_prefix
        ? `${b.api_key_prefix}_${'•'.repeat(20)}${b.api_key_last_four}`
        : null,
      commission_rate: Number(b.commission_rate),
      platform_fee_rate: Number(b.platform_fee_rate),
      wallet_balance_tzs: Number(b.wallet_balance_tzs),
      wallet_alert_threshold_tzs: Number(b.wallet_alert_threshold_tzs),
      low_balance: Number(b.wallet_balance_tzs) < Number(b.wallet_alert_threshold_tzs),
      partners: Number(b.partners),
      partners_active: Number(b.partners_active),
      transactions: Number(b.transactions),
      commissions_paid_tzs: Number(b.commissions_paid),
      platform_fees_tzs: Number(b.fees),
      created_at: b.created_at,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-businesses', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

router.post(
  '/businesses',
  asyncRoute(async (req, res) => {
    const {
      name,
      website,
      category,
      commission_rate = 0.08,
      platform_fee_rate = 0.01,
      wallet_alert_threshold_tzs = 500000,
      signup_url_template,
      notification_email,
      owner_name,
      owner_email,
      owner_password,
    } = req.body || {};

    if (!name || String(name).trim().length < 2) throw badRequest('Enter the business name');
    const rate = Number(commission_rate);
    const fee = Number(platform_fee_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5)
      throw badRequest('Commission rate must be between 0% and 50%');
    if (!Number.isFinite(fee) || fee < 0 || fee > 0.5)
      throw badRequest('Platform fee must be between 0% and 50%');

    const ownerEmail = String(owner_email || '').trim().toLowerCase();
    if (!isEmail(ownerEmail)) throw badRequest('Enter a valid owner email');
    const pwProblem = passwordProblem(owner_password);
    if (pwProblem) throw badRequest(pwProblem);

    const exists = await queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [ownerEmail]);
    if (exists) throw conflict('That owner email already has a Pazo account');

    let slug = slugify(name);
    const slugTaken = await queryOne('SELECT id FROM businesses WHERE slug = ?', [slug]);
    if (slugTaken) slug = `${slug}-${randomToken(2)}`;

    const businessId = uuid();
    const ownerId = uuid();
    const apiKey = generateApiKey();

    await transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO businesses
           (id, name, website, slug, category, signup_url_template, api_key_hash, api_key_prefix,
            api_key_last_four, api_key_rotated_at, commission_rate, platform_fee_rate,
            wallet_balance_tzs, wallet_alert_threshold_tzs, notification_email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, 0, ?, ?, 'active')`,
        [
          businessId,
          String(name).trim(),
          website || null,
          slug,
          category || null,
          signup_url_template || `https://${String(website || 'example.com').replace(/^https?:\/\//, '')}/signup?ref={CODE}`,
          apiKey.hash,
          apiKey.prefix,
          apiKey.lastFour,
          rate,
          fee,
          Math.floor(Number(wallet_alert_threshold_tzs)) || 500000,
          notification_email || ownerEmail,
        ],
      );
      await tx.exec(
        `INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
         VALUES (?, ?, ?, 'business_owner', 'active', ?, ?, 1)`,
        [
          ownerId,
          ownerEmail,
          await hashPassword(owner_password),
          String(owner_name || name).trim(),
          avatarColorFor(ownerId),
        ],
      );
      await tx.exec(
        "INSERT INTO business_members (id, business_id, user_id, access, is_owner) VALUES (?, ?, ?, 'full', 1)",
        [uuid(), businessId, ownerId],
      );
    });

    await recordAudit({
      actor: req.user,
      action: 'admin.business_created',
      resourceType: 'business',
      resourceId: businessId,
      detail: { name, owner_email: ownerEmail },
      ip: clientIp(req),
    });

    return ok(
      res,
      {
        id: businessId,
        api_key: apiKey.key,
        warning: 'Copy this API key now. It is shown once and cannot be retrieved again.',
      },
      201,
    );
  }),
);

router.get(
  '/businesses/:id',
  asyncRoute(async (req, res) => {
    const b = await queryOne('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
    if (!b) throw notFound('Business not found');

    const [stats, team, ledger, topPartners] = await Promise.all([
      queryOne(
        `SELECT
          (SELECT COUNT(*) FROM partners WHERE business_id = ?) AS partners,
          (SELECT COUNT(*) FROM referrals WHERE business_id = ?) AS referrals,
          (SELECT COUNT(*) FROM transactions WHERE business_id = ?) AS transactions,
          (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions WHERE business_id = ?) AS sales,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE business_id = ? AND commission_status='paid') AS commissions,
          (SELECT COALESCE(SUM(platform_fee_tzs),0) FROM transactions WHERE business_id = ?) AS fees,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE business_id = ? AND commission_status='pending') AS pending`,
        [req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id],
      ),
      query(
        `SELECT bm.id, bm.access, bm.is_owner, u.name, u.email, u.status, u.last_login_at
           FROM business_members bm JOIN users u ON u.id = bm.user_id
          WHERE bm.business_id = ? ORDER BY bm.is_owner DESC`,
        [req.params.id],
      ),
      query(
        `SELECT id, entry_type, amount_tzs, balance_after_tzs, description, created_at
           FROM wallet_ledger WHERE business_id = ?
          ORDER BY created_at DESC LIMIT 25`,
        [req.params.id],
      ),
      query(
        `SELECT p.id, p.referral_code, p.partner_type, p.total_earnings_tzs, u.name
           FROM partners p JOIN users u ON u.id = p.user_id
          WHERE p.business_id = ? ORDER BY p.total_earnings_tzs DESC LIMIT 8`,
        [req.params.id],
      ),
    ]);

    return ok(res, {
      business: {
        id: b.id,
        name: b.name,
        website: b.website,
        slug: b.slug,
        category: b.category,
        status: b.status,
        commission_rate: Number(b.commission_rate),
        platform_fee_rate: Number(b.platform_fee_rate),
        wallet_balance_tzs: Number(b.wallet_balance_tzs),
        wallet_alert_threshold_tzs: Number(b.wallet_alert_threshold_tzs),
        notification_email: b.notification_email,
        signup_url_template: b.signup_url_template,
        api_key_masked: b.api_key_prefix
          ? `${b.api_key_prefix}_${'•'.repeat(20)}${b.api_key_last_four}`
          : null,
        api_key_rotated_at: b.api_key_rotated_at,
        created_at: b.created_at,
      },
      stats: {
        partners: Number(stats.partners),
        referrals: Number(stats.referrals),
        transactions: Number(stats.transactions),
        sales_tzs: Number(stats.sales),
        commissions_paid_tzs: Number(stats.commissions),
        platform_fees_tzs: Number(stats.fees),
        pending_commissions_tzs: Number(stats.pending),
      },
      team: team.map((t) => ({ ...t, is_owner: !!t.is_owner })),
      wallet_ledger: ledger.map((l) => ({
        ...l,
        amount_tzs: Number(l.amount_tzs),
        balance_after_tzs: Number(l.balance_after_tzs),
      })),
      top_partners: topPartners.map((p) => ({
        ...p,
        total_earnings_tzs: Number(p.total_earnings_tzs),
      })),
    });
  }),
);

router.put(
  '/businesses/:id',
  asyncRoute(async (req, res) => {
    const b = await queryOne('SELECT id FROM businesses WHERE id = ?', [req.params.id]);
    if (!b) throw notFound('Business not found');

    const allowed = {
      name: (v) => String(v).trim(),
      website: (v) => String(v).trim() || null,
      category: (v) => String(v).trim() || null,
      signup_url_template: (v) => String(v).trim(),
      notification_email: (v) => {
        const m = String(v).trim().toLowerCase();
        if (m && !isEmail(m)) throw badRequest('Enter a valid notification email');
        return m || null;
      },
      commission_rate: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 0.5)
          throw badRequest('Commission rate must be between 0% and 50%');
        return n;
      },
      platform_fee_rate: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 0.5)
          throw badRequest('Platform fee must be between 0% and 50%');
        return n;
      },
      wallet_alert_threshold_tzs: (v) => Math.max(0, Math.floor(Number(v)) || 0),
      status: (v) => {
        if (!['active', 'suspended'].includes(v)) throw badRequest('Status must be active or suspended');
        return v;
      },
    };

    const sets = [];
    const params = [];
    for (const [key, coerce] of Object.entries(allowed)) {
      if (req.body?.[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(coerce(req.body[key]));
      }
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(req.params.id);

    await execute(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`, params);
    await recordAudit({
      actor: req.user,
      action: 'admin.business_updated',
      resourceType: 'business',
      resourceId: req.params.id,
      detail: req.body,
      ip: clientIp(req),
    });
    return ok(res, { updated: true });
  }),
);

router.post(
  '/businesses/:id/api-key/regenerate',
  asyncRoute(async (req, res) => {
    const b = await queryOne('SELECT id, name FROM businesses WHERE id = ?', [req.params.id]);
    if (!b) throw notFound('Business not found');
    const apiKey = generateApiKey();
    await execute(
      `UPDATE businesses SET api_key_hash = ?, api_key_prefix = ?, api_key_last_four = ?,
              api_key_rotated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [apiKey.hash, apiKey.prefix, apiKey.lastFour, req.params.id],
    );
    await recordAudit({
      actor: req.user,
      action: 'admin.api_key_regenerated',
      resourceType: 'business',
      resourceId: req.params.id,
      detail: { name: b.name },
      ip: clientIp(req),
    });
    return ok(res, {
      api_key: apiKey.key,
      warning: 'Copy this key now. It is shown once and cannot be retrieved again.',
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Wallet top-up - credits a business wallet and settles pending       */
/* ------------------------------------------------------------------ */
router.post(
  '/businesses/:id/wallet/topup',
  asyncRoute(async (req, res) => {
    const amount = Math.floor(Number(req.body?.amount_tzs));
    const { reference, note } = req.body || {};
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter the amount received');

    const result = await transaction(async (tx) => {
      const b = await tx.one('SELECT * FROM businesses WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!b) throw notFound('Business not found');
      const newBalance = Number(b.wallet_balance_tzs) + amount;
      await tx.exec('UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?', [
        newBalance,
        b.id,
      ]);
      await tx.exec(
        `INSERT INTO wallet_ledger
           (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, created_by)
         VALUES (?, ?, 'topup', ?, ?, ?, ?)`,
        [
          uuid(),
          b.id,
          amount,
          newBalance,
          note || `Wallet top-up${reference ? ` — ref ${reference}` : ''}`,
          req.user.id,
        ],
      );
      const members = await tx.q('SELECT user_id FROM business_members WHERE business_id = ?', [b.id]);
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
      return { balance_tzs: newBalance };
    });

    // A top-up should immediately release any commissions waiting on funds.
    const settled = await settlePendingForBusiness(req.params.id, req.user.id);

    await recordAudit({
      actor: req.user,
      action: 'admin.wallet_topup',
      resourceType: 'business',
      resourceId: req.params.id,
      detail: { amount_tzs: amount, reference, settled },
      ip: clientIp(req),
    });

    return ok(res, { ...result, settled });
  }),
);

router.post(
  '/businesses/:id/wallet/adjust',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const amount = Math.floor(Number(req.body?.amount_tzs));
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isFinite(amount) || amount === 0)
      throw badRequest('Enter a non-zero adjustment amount');
    if (reason.length < 4) throw badRequest('Give a reason for this adjustment');

    const result = await transaction(async (tx) => {
      const b = await tx.one('SELECT * FROM businesses WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!b) throw notFound('Business not found');
      const newBalance = Number(b.wallet_balance_tzs) + amount;
      if (newBalance < 0) throw badRequest('That adjustment would take the wallet below zero');
      await tx.exec('UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?', [newBalance, b.id]);
      await tx.exec(
        `INSERT INTO wallet_ledger
           (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, created_by)
         VALUES (?, ?, 'adjustment', ?, ?, ?, ?)`,
        [uuid(), b.id, amount, newBalance, reason, req.user.id],
      );
      return { balance_tzs: newBalance };
    });

    await recordAudit({
      actor: req.user,
      action: 'admin.wallet_adjusted',
      resourceType: 'business',
      resourceId: req.params.id,
      detail: { amount_tzs: amount, reason },
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/* ================================================================== */
/* PARTNERS (spec 5.4)                                                 */
/* ================================================================== */
router.get(
  '/partners',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];

    if (req.query.type && ['individual', 'institution'].includes(req.query.type)) {
      where.push('p.partner_type = ?');
      params.push(req.query.type);
    }
    if (req.query.status && ['active', 'suspended', 'inactive'].includes(req.query.status)) {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.business_id) {
      where.push('p.business_id = ?');
      params.push(req.query.business_id);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR p.referral_code LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT p.id, p.referral_code, p.partner_type, p.status, p.total_referrals,
                p.total_earnings_tzs, p.last_active_at, p.created_at,
                u.name, u.email, u.phone, u.status AS user_status,
                b.name AS business_name, b.id AS business_id
           FROM partners p
           JOIN users u ON u.id = p.user_id
           JOIN businesses b ON b.id = p.business_id
           ${whereSql}
          ORDER BY p.total_earnings_tzs DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM partners p JOIN users u ON u.id = p.user_id ${whereSql}`,
        params,
      ),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone ? maskPhone(r.phone) : null,
      partner_type: r.partner_type,
      business_id: r.business_id,
      business_name: r.business_name,
      referral_code: r.referral_code,
      status: r.status,
      total_referrals: Number(r.total_referrals),
      total_earnings_tzs: Number(r.total_earnings_tzs),
      payout_method: r.partner_type === 'individual' ? 'Instant' : 'Monthly',
      last_active_at: r.last_active_at,
      joined_at: r.created_at,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-partners', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

router.get(
  '/partners/:id',
  asyncRoute(async (req, res) => {
    const p = await queryOne(
      `SELECT p.*, u.name, u.email, u.phone, u.status AS user_status, u.last_login_at,
              u.created_at AS joined_at, b.name AS business_name, b.commission_rate AS business_rate,
              b.signup_url_template
         FROM partners p
         JOIN users u ON u.id = p.user_id
         JOIN businesses b ON b.id = p.business_id
        WHERE p.id = ?`,
      [req.params.id],
    );
    if (!p) throw notFound('Partner not found');

    const profile =
      p.partner_type === 'institution'
        ? await queryOne('SELECT * FROM institution_profiles WHERE user_id = ?', [p.user_id])
        : await queryOne('SELECT * FROM individual_profiles WHERE user_id = ?', [p.user_id]);

    const [stats, transactions, payouts] = await Promise.all([
      queryOne(
        `SELECT
          (SELECT COUNT(*) FROM referrals WHERE partner_id = ?) AS referrals,
          (SELECT COUNT(*) FROM referral_clicks WHERE partner_id = ?) AS clicks,
          (SELECT COALESCE(SUM(amount_tzs),0) FROM transactions WHERE partner_id = ?) AS sales,
          (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE partner_id = ? AND commission_status='pending') AS pending`,
        [p.id, p.id, p.id, p.id],
      ),
      query(
        `SELECT id, bundle_type, transaction_type, amount_tzs, commission_tzs, commission_status, created_at
           FROM transactions WHERE partner_id = ? ORDER BY created_at DESC LIMIT 30`,
        [p.id],
      ),
      p.partner_type === 'institution'
        ? query(
            `SELECT id, payout_month, amount_tzs, status, reference, completed_at
               FROM institution_payouts WHERE partner_id = ? ORDER BY payout_month DESC LIMIT 12`,
            [p.id],
          )
        : query(
            `SELECT id, amount_tzs, status, mobile_money_number, requested_at, completed_at
               FROM withdrawals WHERE partner_id = ? ORDER BY requested_at DESC LIMIT 12`,
            [p.id],
          ),
    ]);

    return ok(res, {
      partner: {
        id: p.id,
        user_id: p.user_id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        phone_masked: maskPhone(p.phone),
        partner_type: p.partner_type,
        referral_code: p.referral_code,
        referral_link: buildReferralLink(p.signup_url_template, p.referral_code),
        business_name: p.business_name,
        business_id: p.business_id,
        status: p.status,
        user_status: p.user_status,
        commission_rate: Number(p.commission_rate_override ?? p.business_rate),
        has_custom_rate: p.commission_rate_override !== null,
        total_referrals: Number(p.total_referrals),
        total_earnings_tzs: Number(p.total_earnings_tzs),
        joined_at: p.joined_at,
        last_login_at: p.last_login_at,
        last_active_at: p.last_active_at,
      },
      profile:
        p.partner_type === 'institution'
          ? {
              organisation_name: profile?.organisation_name,
              industry_type: profile?.industry_type,
              contact_person_name: profile?.contact_person_name,
              contact_phone: profile?.contact_phone,
              payout_method: profile?.payout_method,
              payout_account_masked: profile
                ? profile.payout_method === 'mobile_money'
                  ? maskPhone(profile.payout_account)
                  : maskAccount(profile.payout_account)
                : null,
              payout_account_verified: !!profile?.payout_account_verified,
              accumulated_balance_tzs: Number(profile?.accumulated_balance_tzs || 0),
              lifetime_earned_tzs: Number(profile?.lifetime_earned_tzs || 0),
            }
          : {
              first_name: profile?.first_name,
              last_name: profile?.last_name,
              whatsapp_number: profile?.whatsapp_number,
              mobile_money_masked: maskPhone(profile?.mobile_money_number),
              mobile_money_verified: !!profile?.mobile_money_verified,
              wallet_balance_tzs: Number(profile?.wallet_balance_tzs || 0),
              lifetime_earned_tzs: Number(profile?.lifetime_earned_tzs || 0),
              lifetime_withdrawn_tzs: Number(profile?.lifetime_withdrawn_tzs || 0),
            },
      stats: {
        referrals: Number(stats.referrals),
        clicks: Number(stats.clicks),
        sales_tzs: Number(stats.sales),
        pending_tzs: Number(stats.pending),
      },
      transactions: transactions.map((t) => ({
        ...t,
        amount_tzs: Number(t.amount_tzs),
        commission_tzs: Number(t.commission_tzs),
      })),
      payouts: payouts.map((x) => ({
        ...x,
        amount_tzs: Number(x.amount_tzs),
        mobile_money_number: x.mobile_money_number ? maskPhone(x.mobile_money_number) : undefined,
      })),
    });
  }),
);

router.put(
  '/partners/:id',
  asyncRoute(async (req, res) => {
    const p = await queryOne('SELECT * FROM partners WHERE id = ?', [req.params.id]);
    if (!p) throw notFound('Partner not found');

    const { status, commission_rate_override, referral_code } = req.body || {};
    const sets = [];
    const params = [];

    if (status !== undefined) {
      if (!['active', 'suspended', 'inactive'].includes(status))
        throw badRequest('Status must be active, suspended or inactive');
      sets.push('status = ?');
      params.push(status);
      await execute("UPDATE users SET status = ? WHERE id = ?", [
        status === 'suspended' ? 'suspended' : 'active',
        p.user_id,
      ]);
      if (status === 'suspended')
        await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [p.user_id]);
    }
    if (commission_rate_override !== undefined) {
      const rate =
        commission_rate_override === null || commission_rate_override === ''
          ? null
          : Number(commission_rate_override);
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 0.5))
        throw badRequest('Commission rate must be between 0% and 50%');
      sets.push('commission_rate_override = ?');
      params.push(rate);
    }
    // Codes are immutable to partners but a super admin can correct a mistake.
    if (referral_code !== undefined) {
      if (req.user.role !== 'super_admin')
        throw badRequest('Only a super admin can change a referral code');
      const code = normaliseCode(referral_code);
      if (!isValidCode(code)) throw badRequest('Code must be 4-10 letters or numbers');
      const taken = await queryOne('SELECT id FROM partners WHERE referral_code = ? AND id <> ?', [
        code,
        p.id,
      ]);
      if (taken) throw conflict('That referral code is already taken');
      sets.push('referral_code = ?');
      params.push(code);
    }

    if (!sets.length) throw badRequest('Nothing to update');
    params.push(p.id);
    await execute(`UPDATE partners SET ${sets.join(', ')} WHERE id = ?`, params);

    await recordAudit({
      actor: req.user,
      action: 'admin.partner_updated',
      resourceType: 'partner',
      resourceId: p.id,
      detail: req.body,
      ip: clientIp(req),
    });
    return ok(res, { updated: true });
  }),
);

router.post(
  '/partners/:id/notify',
  asyncRoute(async (req, res) => {
    const p = await queryOne('SELECT user_id FROM partners WHERE id = ?', [req.params.id]);
    if (!p) throw notFound('Partner not found');
    const { title, body } = req.body || {};
    if (!body || String(body).trim().length < 2) throw badRequest('Write a message to send');

    await notify({
      userId: p.user_id,
      type: 'custom',
      params: { title: title || 'Message from Pazo', body: String(body).trim() },
    });
    await recordAudit({
      actor: req.user,
      action: 'admin.partner_notified',
      resourceType: 'partner',
      resourceId: p.id,
      ip: clientIp(req),
    });
    return ok(res, { sent: true });
  }),
);

/** Create an individual partner directly (admin-assisted onboarding). */
router.post(
  '/partners',
  asyncRoute(async (req, res) => {
    const {
      business_id,
      first_name,
      last_name,
      email,
      phone,
      whatsapp_number,
      referral_code,
      password,
      commission_rate_override,
    } = req.body || {};

    const business = await queryOne('SELECT * FROM businesses WHERE id = ?', [business_id]);
    if (!business) throw badRequest('Choose a business for this partner');

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isEmail(cleanEmail)) throw badRequest('Enter a valid email address');
    const cleanPhone = normalisePhone(phone);
    if (!cleanPhone) throw badRequest('Enter a valid Tanzanian phone number');
    const code = normaliseCode(referral_code);
    if (!isValidCode(code)) throw badRequest('Code must be 4-10 letters or numbers');
    const pwProblem = passwordProblem(password);
    if (pwProblem) throw badRequest(pwProblem);

    const [emailTaken, phoneTaken, codeTaken] = await Promise.all([
      queryOne('SELECT id FROM users WHERE email = ?', [cleanEmail]),
      queryOne('SELECT id FROM users WHERE phone = ?', [cleanPhone]),
      queryOne('SELECT id FROM partners WHERE referral_code = ?', [code]),
    ]);
    if (emailTaken) throw conflict('That email already has an account');
    if (phoneTaken) throw conflict('That phone number already has an account');
    if (codeTaken) throw conflict('That referral code is taken');

    const userId = uuid();
    const partnerId = uuid();
    const fullName = `${String(first_name).trim()} ${String(last_name).trim()}`;

    await transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO users (id, email, phone, password_hash, role, status, name, avatar_color, phone_verified, email_verified)
         VALUES (?, ?, ?, ?, 'individual', 'active', ?, ?, 1, 1)`,
        [userId, cleanEmail, cleanPhone, await hashPassword(password), fullName, avatarColorFor(userId)],
      );
      await tx.exec(
        `INSERT INTO individual_profiles
           (id, user_id, first_name, last_name, whatsapp_number, mobile_money_number, mobile_money_verified)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          uuid(),
          userId,
          String(first_name).trim(),
          String(last_name).trim(),
          normalisePhone(whatsapp_number) || cleanPhone,
          cleanPhone,
        ],
      );
      await tx.exec(
        `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, commission_rate_override, status)
         VALUES (?, ?, ?, 'individual', ?, ?, 'active')`,
        [
          partnerId,
          userId,
          business.id,
          code,
          commission_rate_override ? Number(commission_rate_override) : null,
        ],
      );
      await notify(
        { userId, type: 'welcome', params: { name: String(first_name).trim(), code } },
        tx,
      );
    });

    await recordAudit({
      actor: req.user,
      action: 'admin.partner_created',
      resourceType: 'partner',
      resourceId: partnerId,
      detail: { email: cleanEmail, code },
      ip: clientIp(req),
    });

    return ok(
      res,
      {
        partner_id: partnerId,
        referral_code: code,
        referral_link: buildReferralLink(business.signup_url_template, code),
      },
      201,
    );
  }),
);

/* ================================================================== */
/* INSTITUTION APPROVAL QUEUE (spec 5.5)                               */
/* ================================================================== */
router.get(
  '/institutions/applications',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const status = ['pending', 'approved', 'declined'].includes(req.query.status)
      ? req.query.status
      : 'pending';

    const [rows, count] = await Promise.all([
      query(
        `SELECT a.*, b.name AS business_name FROM institution_applications a
           JOIN businesses b ON b.id = a.business_id
          WHERE a.status = ? ORDER BY a.created_at ASC LIMIT ? OFFSET ?`,
        [status, limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM institution_applications WHERE status = ?', [status]),
    ]);

    return ok(res, paged(rows, Number(count.n), page, limit));
  }),
);

router.post(
  '/institutions/applications/:id/approve',
  asyncRoute(async (req, res) => {
    const app = await queryOne(
      "SELECT * FROM institution_applications WHERE id = ? AND status = 'pending'",
      [req.params.id],
    );
    if (!app) throw notFound('No pending application with that ID');

    const code = normaliseCode(req.body?.referral_code);
    if (!isValidCode(code)) throw badRequest('Set a referral code of 4-10 letters or numbers');

    const codeTaken = await queryOne('SELECT id FROM partners WHERE referral_code = ?', [code]);
    if (codeTaken) throw conflict('That referral code is taken');

    const emailTaken = await queryOne('SELECT id FROM users WHERE email = ?', [app.contact_email]);
    if (emailTaken) throw conflict('That contact email already has a Pazo account');

    const rateRaw = req.body?.commission_rate_override;
    const rate = rateRaw === undefined || rateRaw === null || rateRaw === '' ? null : Number(rateRaw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 0.5))
      throw badRequest('Commission rate must be between 0% and 50%');

    // A temporary password is emailed; the institution changes it after sign-in.
    const tempPassword = req.body?.password || `Pazo${randomToken(3).toUpperCase()}1`;
    const pwProblem = passwordProblem(tempPassword);
    if (pwProblem) throw badRequest(pwProblem);

    const business = await queryOne('SELECT * FROM businesses WHERE id = ?', [app.business_id]);
    const userId = uuid();
    const partnerId = uuid();

    await transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
         VALUES (?, ?, ?, 'institution', 'active', ?, ?, 1)`,
        [
          userId,
          app.contact_email,
          await hashPassword(tempPassword),
          app.organisation_name,
          avatarColorFor(userId),
        ],
      );
      await tx.exec(
        `INSERT INTO institution_profiles
           (id, user_id, organisation_name, industry_type, contact_person_name, contact_phone,
            payout_method, payout_account, payout_bank_name, payout_account_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          uuid(),
          userId,
          app.organisation_name,
          app.industry_type,
          app.contact_person_name,
          app.contact_phone,
          req.body?.payout_method || app.payout_method,
          req.body?.payout_account || app.payout_account,
          req.body?.payout_bank_name || app.payout_bank_name,
        ],
      );
      await tx.exec(
        `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, commission_rate_override, status)
         VALUES (?, ?, ?, 'institution', ?, ?, 'active')`,
        [partnerId, userId, app.business_id, code, rate],
      );
      await tx.exec(
        `UPDATE institution_applications
            SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), created_partner_id = ?
          WHERE id = ?`,
        [req.user.id, partnerId, app.id],
      );
      await notify(
        {
          userId,
          type: 'account_approved',
          params: { url: `${process.env.APP_URL || 'http://localhost:5173'}/login` },
        },
        tx,
      );
    });

    const link = buildReferralLink(business.signup_url_template, code);
    await deliverExternal({
      channel: 'email',
      to: app.contact_email,
      subject: 'Your Pazo partner account is ready',
      body: `Welcome to the ${business.name} partner programme. Sign in at ${process.env.APP_URL || 'http://localhost:5173'}/login with ${app.contact_email} and the temporary password ${tempPassword}. Your referral code is ${code} and your link is ${link}.`,
    });

    await recordAudit({
      actor: req.user,
      action: 'admin.institution_approved',
      resourceType: 'partner',
      resourceId: partnerId,
      detail: { organisation: app.organisation_name, code },
      ip: clientIp(req),
    });

    return ok(res, {
      approved: true,
      partner_id: partnerId,
      referral_code: code,
      referral_link: link,
      temporary_password: tempPassword,
      login_email: app.contact_email,
    });
  }),
);

router.post(
  '/institutions/applications/:id/decline',
  asyncRoute(async (req, res) => {
    const app = await queryOne(
      "SELECT * FROM institution_applications WHERE id = ? AND status = 'pending'",
      [req.params.id],
    );
    if (!app) throw notFound('No pending application with that ID');
    const reason = String(req.body?.reason || '').trim();

    await execute(
      `UPDATE institution_applications
          SET status = 'declined', decline_reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [reason || null, req.user.id, app.id],
    );
    await deliverExternal({
      channel: 'email',
      to: app.contact_email,
      subject: 'About your Pazo partner application',
      body: `Thank you for applying to the partner programme. We are not able to approve this application at the moment.${reason ? ` Reason: ${reason}` : ''} You are welcome to contact partners@pazo.co.tz with any questions.`,
    });
    await recordAudit({
      actor: req.user,
      action: 'admin.institution_declined',
      resourceType: 'application',
      resourceId: app.id,
      detail: { organisation: app.organisation_name, reason },
      ip: clientIp(req),
    });

    return ok(res, { declined: true });
  }),
);

/* ================================================================== */
/* TRANSACTION MONITOR (spec 5.6)                                      */
/* ================================================================== */
router.get(
  '/transactions',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];

    if (req.query.business_id) {
      where.push('t.business_id = ?');
      params.push(req.query.business_id);
    }
    if (req.query.partner_id) {
      where.push('t.partner_id = ?');
      params.push(req.query.partner_id);
    }
    if (req.query.status && ['paid', 'pending', 'failed', 'resolved'].includes(req.query.status)) {
      where.push('t.commission_status = ?');
      params.push(req.query.status);
    }
    if (req.query.type && ['first_purchase', 'topup'].includes(req.query.type)) {
      where.push('t.transaction_type = ?');
      params.push(req.query.type);
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count, totals] = await Promise.all([
      query(
        `SELECT t.*, u.name AS partner_name, p.referral_code, b.name AS business_name,
                r.tourist_external_id
           FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
           LEFT JOIN referrals r ON r.id = t.referral_id
           JOIN businesses b ON b.id = t.business_id
           ${whereSql}
          ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
           JOIN businesses b ON b.id = t.business_id ${whereSql}`,
        params,
      ),
      queryOne(
        `SELECT COALESCE(SUM(t.amount_tzs),0) AS sales,
                COALESCE(SUM(t.commission_tzs),0) AS commission,
                COALESCE(SUM(t.platform_fee_tzs),0) AS fees
           FROM transactions t
           LEFT JOIN partners p ON p.id = t.partner_id
           LEFT JOIN users u ON u.id = p.user_id
           JOIN businesses b ON b.id = t.business_id ${whereSql}`,
        params,
      ),
    ]);

    const items = rows.map((t) => ({
      id: t.id,
      created_at: t.created_at,
      business_name: t.business_name,
      partner_name: t.partner_name || 'No partner',
      referral_code: t.referral_code,
      customer_id: t.tourist_external_id,
      bundle_type: t.bundle_type,
      transaction_type: t.transaction_type,
      amount_tzs: Number(t.amount_tzs),
      commission_tzs: Number(t.commission_tzs),
      platform_fee_tzs: Number(t.platform_fee_tzs),
      commission_rate_applied: Number(t.commission_rate_applied),
      status: t.commission_status,
      failure_reason: t.failure_reason,
      reference: t.external_tx_ref,
      paid_at: t.paid_at,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-transactions', items);

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

router.post(
  '/transactions/:id/resolve',
  asyncRoute(async (req, res) => {
    const t = await queryOne('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    if (!t) throw notFound('Transaction not found');
    if (t.commission_status === 'paid') throw badRequest('That commission is already paid');

    const note = String(req.body?.note || 'Resolved by Pazo admin').slice(0, 250);
    await execute(
      "UPDATE transactions SET commission_status = 'resolved', failure_reason = ? WHERE id = ?",
      [note, t.id],
    );
    await recordAudit({
      actor: req.user,
      action: 'admin.transaction_resolved',
      resourceType: 'transaction',
      resourceId: t.id,
      detail: { note },
      ip: clientIp(req),
    });
    return ok(res, { resolved: true });
  }),
);

router.post(
  '/transactions/settle-pending',
  asyncRoute(async (req, res) => {
    const businessId = req.body?.business_id;
    if (!businessId) throw badRequest('Choose a business to settle');
    const result = await settlePendingForBusiness(businessId, req.user.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.pending_settled',
      resourceType: 'business',
      resourceId: businessId,
      detail: result,
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/* ================================================================== */
/* MONTHLY PAYOUT PROCESSING (spec 5.7)                                */
/* ================================================================== */
router.get(
  '/payouts/monthly/pending',
  asyncRoute(async (req, res) => {
    const month = req.query.month || monthStart();
    const rows = await query(
      `SELECT p.id AS partner_id, p.referral_code, u.name AS organisation_name, u.id AS user_id,
              ip.accumulated_balance_tzs, ip.payout_method, ip.payout_account, ip.payout_bank_name,
              ip.payout_account_verified,
              (SELECT COUNT(*) FROM transactions t
                WHERE t.partner_id = p.id AND t.commission_status = 'paid'
                  AND DATE_FORMAT(t.created_at, '%Y-%m') = DATE_FORMAT(?, '%Y-%m')) AS tx_count,
              (SELECT COALESCE(SUM(t.amount_tzs),0) FROM transactions t
                WHERE t.partner_id = p.id
                  AND DATE_FORMAT(t.created_at, '%Y-%m') = DATE_FORMAT(?, '%Y-%m')) AS sales_tzs,
              (SELECT COUNT(*) FROM referrals r
                WHERE r.partner_id = p.id
                  AND DATE_FORMAT(r.created_at, '%Y-%m') = DATE_FORMAT(?, '%Y-%m')) AS referral_count,
              (SELECT ipay.status FROM institution_payouts ipay
                WHERE ipay.partner_id = p.id AND ipay.payout_month = ? LIMIT 1) AS payout_status
         FROM partners p
         JOIN users u ON u.id = p.user_id
         JOIN institution_profiles ip ON ip.user_id = p.user_id
        WHERE p.partner_type = 'institution' AND p.status = 'active'
        ORDER BY ip.accumulated_balance_tzs DESC`,
      [month, month, month, month],
    );

    const items = rows
      .map((r) => ({
        partner_id: r.partner_id,
        organisation_name: r.organisation_name,
        referral_code: r.referral_code,
        accumulated_balance_tzs: Number(r.accumulated_balance_tzs),
        payout_method: r.payout_method,
        payout_account_masked:
          r.payout_method === 'mobile_money'
            ? maskPhone(r.payout_account)
            : maskAccount(r.payout_account),
        payout_account_verified: !!r.payout_account_verified,
        transaction_count: Number(r.tx_count),
        sales_tzs: Number(r.sales_tzs),
        referral_count: Number(r.referral_count),
        status: r.payout_status || 'queued',
      }))
      .filter((r) => r.accumulated_balance_tzs > 0 || r.status !== 'queued');

    return ok(res, {
      month,
      items,
      summary: {
        institutions: items.filter((i) => i.status === 'queued').length,
        total_tzs: items
          .filter((i) => i.status === 'queued')
          .reduce((s, i) => s + i.accumulated_balance_tzs, 0),
      },
    });
  }),
);

/** Process one institution's payout, zeroing the accumulated balance. */
async function processOnePayout({ partnerId, month, actor }) {
  return transaction(async (tx) => {
    const partner = await tx.one(
      `SELECT p.*, u.name, u.id AS user_id FROM partners p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.partner_type = 'institution' FOR UPDATE`,
      [partnerId],
    );
    if (!partner) throw notFound('Institution partner not found');

    const profile = await tx.one(
      'SELECT * FROM institution_profiles WHERE user_id = ? FOR UPDATE',
      [partner.user_id],
    );
    const amount = Number(profile.accumulated_balance_tzs);
    if (amount <= 0) throw badRequest(`${partner.name} has no balance to pay out`);

    const existing = await tx.one(
      'SELECT id, status FROM institution_payouts WHERE partner_id = ? AND payout_month = ?',
      [partnerId, month],
    );
    if (existing && existing.status === 'completed')
      throw conflict(`${partner.name} has already been paid for this month`);

    const counts = await tx.one(
      `SELECT COUNT(*) AS tx_count, COALESCE(SUM(amount_tzs),0) AS sales
         FROM transactions
        WHERE partner_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(?, '%Y-%m')`,
      [partnerId, month],
    );
    const referrals = await tx.one(
      `SELECT COUNT(*) AS n FROM referrals
        WHERE partner_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(?, '%Y-%m')`,
      [partnerId, month],
    );

    const payoutId = existing?.id || uuid();
    const reference = `PZ-${month.slice(0, 7).replace('-', '')}-${partner.referral_code}`;
    const accountSnapshot =
      profile.payout_method === 'mobile_money'
        ? profile.payout_account
        : `${profile.payout_bank_name || ''} ${profile.payout_account || ''}`.trim();

    if (existing) {
      await tx.exec(
        `UPDATE institution_payouts
            SET amount_tzs = ?, transaction_count = ?, referral_count = ?, sales_total_tzs = ?,
                payout_account_snapshot = ?, status = 'completed', reference = ?,
                processed_by = ?, processed_at = UTC_TIMESTAMP(), completed_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [
          amount,
          Number(counts.tx_count),
          Number(referrals.n),
          Number(counts.sales),
          accountSnapshot,
          reference,
          actor.id,
          payoutId,
        ],
      );
    } else {
      await tx.exec(
        `INSERT INTO institution_payouts
           (id, partner_id, payout_month, amount_tzs, transaction_count, referral_count,
            sales_total_tzs, payout_account_snapshot, status, reference, processed_by,
            processed_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [
          payoutId,
          partnerId,
          month,
          amount,
          Number(counts.tx_count),
          Number(referrals.n),
          Number(counts.sales),
          accountSnapshot,
          reference,
          actor.id,
        ],
      );
    }

    await tx.exec(
      'UPDATE institution_profiles SET accumulated_balance_tzs = 0 WHERE user_id = ?',
      [partner.user_id],
    );
    await notify(
      {
        userId: partner.user_id,
        type: 'monthly_payout',
        params: {
          amount,
          when: new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }),
        },
        data: { payout_id: payoutId, reference },
      },
      tx,
    );

    return {
      payout_id: payoutId,
      partner_id: partnerId,
      organisation_name: partner.name,
      amount_tzs: amount,
      reference,
    };
  });
}

router.post(
  '/payouts/monthly/:partnerId/process',
  asyncRoute(async (req, res) => {
    const month = req.body?.month || monthStart();
    const result = await processOnePayout({
      partnerId: req.params.partnerId,
      month,
      actor: req.user,
    });
    await recordAudit({
      actor: req.user,
      action: 'admin.payout_processed',
      resourceType: 'payout',
      resourceId: result.payout_id,
      detail: result,
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

router.post(
  '/payouts/monthly/process',
  asyncRoute(async (req, res) => {
    const month = req.body?.month || monthStart();
    const candidates = await query(
      `SELECT p.id FROM partners p
         JOIN institution_profiles ip ON ip.user_id = p.user_id
        WHERE p.partner_type = 'institution' AND p.status = 'active'
          AND ip.accumulated_balance_tzs > 0`,
    );

    const processed = [];
    const failed = [];
    for (const c of candidates) {
      try {
        processed.push(await processOnePayout({ partnerId: c.id, month, actor: req.user }));
      } catch (err) {
        failed.push({ partner_id: c.id, error: err.message });
      }
    }

    await recordAudit({
      actor: req.user,
      action: 'admin.payout_batch_processed',
      resourceType: 'payout_batch',
      resourceId: month,
      detail: { count: processed.length, total: processed.reduce((s, p) => s + p.amount_tzs, 0) },
      ip: clientIp(req),
    });

    return ok(res, {
      month,
      processed,
      failed,
      total_tzs: processed.reduce((s, p) => s + p.amount_tzs, 0),
    });
  }),
);

router.get(
  '/payouts/monthly/history',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count] = await Promise.all([
      query(
        `SELECT ipay.*, u.name AS organisation_name, p.referral_code, a.name AS processed_by_name
           FROM institution_payouts ipay
           JOIN partners p ON p.id = ipay.partner_id
           JOIN users u ON u.id = p.user_id
           LEFT JOIN users a ON a.id = ipay.processed_by
          ORDER BY ipay.payout_month DESC, ipay.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM institution_payouts'),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      month: r.payout_month,
      organisation_name: r.organisation_name,
      referral_code: r.referral_code,
      amount_tzs: Number(r.amount_tzs),
      transaction_count: Number(r.transaction_count),
      sales_total_tzs: Number(r.sales_total_tzs),
      status: r.status,
      reference: r.reference,
      processed_by_name: r.processed_by_name,
      completed_at: r.completed_at,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-payouts', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/* ================================================================== */
/* WITHDRAWALS (individual payout monitor)                             */
/* ================================================================== */
router.get(
  '/withdrawals',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (
      req.query.status &&
      ['queued', 'processing', 'completed', 'failed', 'reversed'].includes(req.query.status)
    ) {
      where.push('w.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR p.referral_code LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT w.*, u.name AS partner_name, p.referral_code
           FROM withdrawals w
           JOIN partners p ON p.id = w.partner_id
           JOIN users u ON u.id = p.user_id
           ${whereSql}
          ORDER BY w.requested_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(
        `SELECT COUNT(*) AS n FROM withdrawals w
           JOIN partners p ON p.id = w.partner_id
           JOIN users u ON u.id = p.user_id ${whereSql}`,
        params,
      ),
    ]);

    const items = rows.map((w) => ({
      id: w.id,
      partner_name: w.partner_name,
      referral_code: w.referral_code,
      amount_tzs: Number(w.amount_tzs),
      fee_tzs: Number(w.fee_tzs),
      destination: maskPhone(w.mobile_money_number),
      beneficiary_name: w.beneficiary_name,
      channel_provider: w.channel_provider,
      status: w.status,
      provider: w.provider,
      provider_status: w.provider_status,
      order_reference: w.order_reference,
      reference: w.provider_reference,
      failure_reason: w.failure_reason,
      attempts: Number(w.attempts),
      next_attempt_at: w.next_attempt_at,
      requested_at: w.requested_at,
      completed_at: w.completed_at,
    }));

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-withdrawals', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

/**
 * Retry a payout that failed or is stuck in the queue.
 * A failed withdrawal was already refunded, so re-queueing takes the money
 * back out of the partner wallet before the gateway is called again.
 */
router.post(
  '/withdrawals/:id/retry',
  asyncRoute(async (req, res) => {
    const w = await queryOne('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!w) throw notFound('Withdrawal not found');
    if (w.status === 'completed') throw badRequest('That withdrawal is already complete');

    if (['failed', 'reversed'].includes(w.status)) {
      await transaction(async (tx) => {
        const profile = await tx.one(
          `SELECT ip.* FROM individual_profiles ip
             JOIN partners p ON p.user_id = ip.user_id
            WHERE p.id = ? FOR UPDATE`,
          [w.partner_id],
        );
        if (!profile) throw notFound('Partner profile not found');
        if (Number(profile.wallet_balance_tzs) < Number(w.amount_tzs))
          throw badRequest('The partner no longer has enough balance to retry this payout');

        await tx.exec(
          `UPDATE individual_profiles
              SET wallet_balance_tzs = wallet_balance_tzs - ?,
                  lifetime_withdrawn_tzs = lifetime_withdrawn_tzs + ?
            WHERE user_id = ?`,
          [Number(w.amount_tzs), Number(w.amount_tzs), profile.user_id],
        );
        // A fresh reference, because the old one is spent at the provider.
        await tx.exec(
          `UPDATE withdrawals
              SET status = 'queued', failure_reason = NULL, next_attempt_at = NULL,
                  order_reference = NULL, completed_at = NULL
            WHERE id = ?`,
          [w.id],
        );
      });
    } else {
      await execute(
        "UPDATE withdrawals SET status = 'queued', next_attempt_at = NULL WHERE id = ?",
        [w.id],
      );
    }

    const result = await submitWithdrawal(w.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.withdrawal_retried',
      resourceType: 'withdrawal',
      resourceId: w.id,
      detail: { amount_tzs: Number(w.amount_tzs), result },
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/** Ask the gateway what really happened and bring the local row into line. */
router.post(
  '/withdrawals/:id/reconcile',
  asyncRoute(async (req, res) => {
    const result = await reconcileWithdrawal(req.params.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.withdrawal_reconciled',
      resourceType: 'withdrawal',
      resourceId: req.params.id,
      detail: result,
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/**
 * Manual override for a payout settled outside the gateway. Restricted to a
 * super admin because it marks money as sent without the provider confirming.
 */
router.post(
  '/withdrawals/:id/complete',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const reference = String(req.body?.reference || '').trim();
    if (!reference) throw badRequest('Enter the payment reference for this manual settlement');

    const result = await completeWithdrawal({
      withdrawalId: req.params.id,
      providerReference: reference,
      providerStatus: 'MANUAL',
    });
    if (!result.ok) throw notFound('Withdrawal not found');

    await recordAudit({
      actor: req.user,
      action: 'admin.withdrawal_completed_manually',
      resourceType: 'withdrawal',
      resourceId: req.params.id,
      detail: { reference },
      ip: clientIp(req),
    });
    return ok(res, { completed: true, reference });
  }),
);

/** Mark a payout failed and return the money to the partner. */
router.post(
  '/withdrawals/:id/fail',
  asyncRoute(async (req, res) => {
    const reason = String(req.body?.reason || 'Payment could not be completed').slice(0, 250);
    const result = await failWithdrawal({ withdrawalId: req.params.id, reason, refund: true });
    if (!result.ok) throw notFound('Withdrawal not found');

    await recordAudit({
      actor: req.user,
      action: 'admin.withdrawal_failed',
      resourceType: 'withdrawal',
      resourceId: req.params.id,
      detail: { reason, refunded_tzs: result.refunded_tzs },
      ip: clientIp(req),
    });
    return ok(res, { failed: true, ...result });
  }),
);

/* ------------------------------------------------------------------ */
/* Gateway status and controls                                         */
/* ------------------------------------------------------------------ */
router.get(
  '/gateway/status',
  asyncRoute(async (req, res) => {
    const [queue, recent, events] = await Promise.all([
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM withdrawals WHERE status = 'queued') AS queued,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM withdrawals WHERE status = 'queued') AS queued_tzs,
           (SELECT COUNT(*) FROM withdrawals WHERE status = 'processing') AS processing,
           (SELECT COUNT(*) FROM withdrawals WHERE status = 'failed'
             AND requested_at > (UTC_TIMESTAMP() - INTERVAL 7 DAY)) AS failed_week,
           (SELECT COALESCE(SUM(amount_tzs),0) FROM withdrawals
             WHERE status IN ('processing','completed')
               AND last_attempt_at > (UTC_TIMESTAMP() - INTERVAL 1 DAY)) AS sent_today`,
      ),
      query(
        `SELECT operation, status_code, error_message, duration_ms, created_at
           FROM gateway_requests ORDER BY created_at DESC LIMIT 10`,
      ),
      query(
        `SELECT event_type, order_reference, signature_valid, processed, process_result, created_at
           FROM gateway_events ORDER BY created_at DESC LIMIT 10`,
      ),
    ]);

    // The live float at the provider is what payouts actually draw on, so it
    // is worth showing next to the queue.
    let balance = null;
    let balanceError = null;
    if (gatewayConfigured()) {
      try {
        balance = await getBalance();
      } catch (err) {
        balanceError = err.message;
      }
    }

    return ok(res, {
      configured: gatewayConfigured(),
      checksum_enabled: Boolean(process.env.CLICKPESA_CHECKSUM_KEY),
      balance,
      balance_error: balanceError,
      queue: {
        queued: Number(queue.queued),
        queued_tzs: Number(queue.queued_tzs),
        processing: Number(queue.processing),
        failed_this_week: Number(queue.failed_week),
        sent_today_tzs: Number(queue.sent_today),
      },
      recent_calls: recent,
      recent_events: events.map((e) => ({ ...e, signature_valid: !!e.signature_valid, processed: !!e.processed })),
    });
  }),
);

/** Send the next queued payout now rather than waiting for the worker. */
router.post(
  '/gateway/drain-queue',
  asyncRoute(async (req, res) => {
    const result = await drainPayoutQueue();
    await recordAudit({
      actor: req.user,
      action: 'admin.payout_queue_drained',
      resourceType: 'gateway',
      detail: result,
      ip: clientIp(req),
    });
    return ok(res, result);
  }),
);

/* ------------------------------------------------------------------ */
/* Wallet top-ups across all businesses                                */
/* ------------------------------------------------------------------ */
router.get(
  '/wallet-topups',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (req.query.business_id) {
      where.push('t.business_id = ?');
      params.push(req.query.business_id);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT t.*, b.name AS business_name FROM wallet_topups t
           JOIN businesses b ON b.id = t.business_id
           ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM wallet_topups t ${whereSql}`, params),
    ]);

    return ok(
      res,
      paged(
        rows.map((t) => ({
          id: t.id,
          business_name: t.business_name,
          reference: t.order_reference,
          method: t.method,
          amount_tzs: Number(t.amount_tzs),
          destination: t.phone_number ? maskPhone(t.phone_number) : null,
          status: t.status,
          credited: !!t.credited,
          failure_reason: t.failure_reason,
          created_at: t.created_at,
          credited_at: t.credited_at,
        })),
        Number(count.n),
        page,
        limit,
      ),
    );
  }),
);

/* ================================================================== */
/* COMMUNICATIONS (spec 5.8)                                           */
/* ================================================================== */
async function resolveAudience(audience, ref) {
  switch (audience) {
    case 'all_partners':
      return query(
        "SELECT DISTINCT u.id, u.name, u.email, u.phone FROM users u JOIN partners p ON p.user_id = u.id WHERE u.status = 'active'",
      );
    case 'individuals':
      return query(
        "SELECT u.id, u.name, u.email, u.phone FROM users u JOIN partners p ON p.user_id = u.id WHERE p.partner_type = 'individual' AND u.status = 'active'",
      );
    case 'institutions':
      return query(
        "SELECT u.id, u.name, u.email, u.phone FROM users u JOIN partners p ON p.user_id = u.id WHERE p.partner_type = 'institution' AND u.status = 'active'",
      );
    case 'business':
      return query(
        "SELECT u.id, u.name, u.email, u.phone FROM users u JOIN business_members bm ON bm.user_id = u.id WHERE u.status = 'active'",
      );
    case 'business_partners':
      return query(
        "SELECT u.id, u.name, u.email, u.phone FROM users u JOIN partners p ON p.user_id = u.id WHERE p.business_id = ? AND u.status = 'active'",
        [ref],
      );
    case 'single': {
      const phone = normalisePhone(ref);
      return query(
        'SELECT id, name, email, phone FROM users WHERE (phone = ? OR email = ?) LIMIT 1',
        [phone, String(ref || '').trim().toLowerCase()],
      );
    }
    default:
      return [];
  }
}

router.post(
  '/comms/send',
  asyncRoute(async (req, res) => {
    const { channel, audience, audience_ref, subject, body } = req.body || {};
    if (!['sms', 'email', 'in_app'].includes(channel))
      throw badRequest('Choose SMS, email or in-app');
    if (!body || String(body).trim().length < 2) throw badRequest('Write your message');

    const recipients = await resolveAudience(audience, audience_ref);
    if (!recipients.length) throw badRequest('That audience has no one in it right now');

    let delivered = 0;
    let failedCount = 0;

    if (channel === 'in_app') {
      delivered = await notifyMany(
        recipients.map((r) => r.id),
        'custom',
        { title: subject || 'Message from Pazo', body: String(body).trim() },
      );
    } else {
      for (const r of recipients) {
        const to = channel === 'sms' ? r.phone : r.email;
        if (!to) {
          failedCount += 1;
          continue;
        }
        try {
          await deliverExternal({ channel, to, subject, body: String(body).trim() });
          delivered += 1;
        } catch {
          failedCount += 1;
        }
      }
      // Every outbound message also lands in the in-app feed so nothing is missed.
      await notifyMany(
        recipients.map((r) => r.id),
        'custom',
        { title: subject || 'Message from Pazo', body: String(body).trim() },
      );
    }

    const commId = uuid();
    await execute(
      `INSERT INTO communications
         (id, channel, audience, audience_ref, subject, body, recipient_count, delivered_count, failed_count, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        commId,
        channel,
        audience,
        audience_ref || null,
        subject || null,
        String(body).trim(),
        recipients.length,
        delivered,
        failedCount,
        req.user.id,
      ],
    );
    await recordAudit({
      actor: req.user,
      action: 'admin.comms_sent',
      resourceType: 'communication',
      resourceId: commId,
      detail: { channel, audience, recipients: recipients.length },
      ip: clientIp(req),
    });

    return ok(res, {
      sent: true,
      recipients: recipients.length,
      delivered,
      failed: failedCount,
    });
  }),
);

router.get(
  '/comms/history',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count] = await Promise.all([
      query(
        `SELECT c.*, u.name AS sent_by_name FROM communications c
           LEFT JOIN users u ON u.id = c.sent_by
          ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM communications'),
    ]);
    return ok(res, paged(rows, Number(count.n), page, limit));
  }),
);

/* ---- message templates CRUD ---- */
router.get(
  '/comms/templates',
  asyncRoute(async (req, res) => ok(res, { items: await query('SELECT * FROM message_templates ORDER BY name ASC') })),
);

router.post(
  '/comms/templates',
  asyncRoute(async (req, res) => {
    const { name, channel, subject, body } = req.body || {};
    if (!name || String(name).trim().length < 2) throw badRequest('Give the template a name');
    if (!['sms', 'email', 'in_app'].includes(channel)) throw badRequest('Choose a channel');
    if (!body || String(body).trim().length < 2) throw badRequest('Write the template body');

    const id = uuid();
    await execute(
      'INSERT INTO message_templates (id, name, channel, subject, body, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), channel, subject || null, String(body).trim(), req.user.id],
    );
    return ok(res, { id }, 201);
  }),
);

router.put(
  '/comms/templates/:id',
  asyncRoute(async (req, res) => {
    const t = await queryOne('SELECT id FROM message_templates WHERE id = ?', [req.params.id]);
    if (!t) throw notFound('Template not found');
    const { name, channel, subject, body } = req.body || {};
    await execute(
      'UPDATE message_templates SET name = COALESCE(?, name), channel = COALESCE(?, channel), subject = ?, body = COALESCE(?, body) WHERE id = ?',
      [name || null, channel || null, subject ?? null, body || null, req.params.id],
    );
    return ok(res, { updated: true });
  }),
);

router.delete(
  '/comms/templates/:id',
  asyncRoute(async (req, res) => {
    await execute('DELETE FROM message_templates WHERE id = ?', [req.params.id]);
    return ok(res, { deleted: true });
  }),
);

/* ---- announcements CRUD ---- */
router.get(
  '/announcements',
  asyncRoute(async (req, res) =>
    ok(res, {
      items: await query(
        'SELECT a.*, u.name AS created_by_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC',
      ),
    }),
  ),
);

router.post(
  '/announcements',
  asyncRoute(async (req, res) => {
    const { title, body, audience = 'all', variant = 'info', starts_at, ends_at } = req.body || {};
    if (!title || String(title).trim().length < 2) throw badRequest('Give the announcement a title');
    if (!body || String(body).trim().length < 2) throw badRequest('Write the announcement');

    const id = uuid();
    await execute(
      `INSERT INTO announcements (id, title, body, audience, variant, active, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        String(title).trim(),
        String(body).trim(),
        audience,
        variant,
        starts_at ? toMysqlDateTime(starts_at) : null,
        ends_at ? toMysqlDateTime(ends_at) : null,
        req.user.id,
      ],
    );
    await recordAudit({
      actor: req.user,
      action: 'admin.announcement_created',
      resourceType: 'announcement',
      resourceId: id,
      ip: clientIp(req),
    });
    return ok(res, { id }, 201);
  }),
);

router.put(
  '/announcements/:id',
  asyncRoute(async (req, res) => {
    const a = await queryOne('SELECT id FROM announcements WHERE id = ?', [req.params.id]);
    if (!a) throw notFound('Announcement not found');
    const { title, body, audience, variant, active } = req.body || {};
    await execute(
      `UPDATE announcements
          SET title = COALESCE(?, title), body = COALESCE(?, body),
              audience = COALESCE(?, audience), variant = COALESCE(?, variant),
              active = COALESCE(?, active)
        WHERE id = ?`,
      [
        title || null,
        body || null,
        audience || null,
        variant || null,
        active === undefined ? null : active ? 1 : 0,
        req.params.id,
      ],
    );
    return ok(res, { updated: true });
  }),
);

router.delete(
  '/announcements/:id',
  asyncRoute(async (req, res) => {
    await execute('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    return ok(res, { deleted: true });
  }),
);

/* ================================================================== */
/* SYSTEM CONFIGURATION (spec 5.9)                                     */
/* ================================================================== */
router.get(
  '/config',
  asyncRoute(async (req, res) => ok(res, { settings: await allSettings() })),
);

router.put(
  '/config',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const entries = req.body?.settings;
    if (!entries || typeof entries !== 'object') throw badRequest('Send the settings to update');
    const settings = await updateSettings(entries, req.user.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.config_updated',
      resourceType: 'settings',
      detail: entries,
      ip: clientIp(req),
    });
    return ok(res, { settings });
  }),
);

/* ================================================================== */
/* CMS - public site content                                           */
/* ================================================================== */
router.get(
  '/cms',
  asyncRoute(async (req, res) =>
    ok(res, {
      items: await query('SELECT * FROM cms_content ORDER BY group_name, sort_order, content_key'),
    }),
  ),
);

router.put(
  '/cms',
  asyncRoute(async (req, res) => {
    const entries = req.body?.content;
    if (!entries || typeof entries !== 'object') throw badRequest('Send the content to update');
    for (const [key, value] of Object.entries(entries)) {
      await execute(
        'UPDATE cms_content SET content_value = ?, updated_by = ? WHERE content_key = ?',
        [String(value), req.user.id, key],
      );
    }
    await recordAudit({
      actor: req.user,
      action: 'admin.cms_updated',
      resourceType: 'cms',
      detail: { keys: Object.keys(entries) },
      ip: clientIp(req),
    });
    return ok(res, {
      items: await query('SELECT * FROM cms_content ORDER BY group_name, sort_order, content_key'),
    });
  }),
);

/* ================================================================== */
/* ADMIN USERS                                                         */
/* ================================================================== */
router.get(
  '/users',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (req.query.role) {
      where.push('role = ?');
      params.push(req.query.role);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT id, name, email, phone, role, status, last_login_at, created_at
           FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM users ${whereSql}`, params),
    ]);

    const items = rows.map((u) => ({ ...u, phone: u.phone ? maskPhone(u.phone) : null }));
    if (req.query.format === 'csv') return sendCsv(res, 'pazo-users', items);
    return ok(res, paged(items, Number(count.n), page, limit));
  }),
);

router.post(
  '/users',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const { name, email, password, role = 'admin' } = req.body || {};
    if (!['admin', 'super_admin'].includes(role))
      throw badRequest('Admin users are created as admin or super admin');
    const clean = String(email || '').trim().toLowerCase();
    if (!isEmail(clean)) throw badRequest('Enter a valid email address');
    if (!name || String(name).trim().length < 2) throw badRequest('Enter a name');
    const pwProblem = passwordProblem(password);
    if (pwProblem) throw badRequest(pwProblem);

    const exists = await queryOne('SELECT id FROM users WHERE email = ?', [clean]);
    if (exists) throw conflict('That email already has an account');

    const id = uuid();
    await execute(
      `INSERT INTO users (id, email, password_hash, role, status, name, avatar_color, email_verified)
       VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`,
      [id, clean, await hashPassword(password), role, String(name).trim(), avatarColorFor(id)],
    );
    await recordAudit({
      actor: req.user,
      action: 'admin.user_created',
      resourceType: 'user',
      resourceId: id,
      detail: { email: clean, role },
      ip: clientIp(req),
    });
    return ok(res, { id }, 201);
  }),
);

router.put(
  '/users/:id/status',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'suspended', 'deactivated'].includes(status))
      throw badRequest('Status must be active, suspended or deactivated');
    if (req.params.id === req.user.id) throw badRequest('You cannot change your own status');

    const u = await queryOne('SELECT id, name FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw notFound('User not found');

    await execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    if (status !== 'active')
      await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [req.params.id]);

    await recordAudit({
      actor: req.user,
      action: 'admin.user_status_changed',
      resourceType: 'user',
      resourceId: req.params.id,
      detail: { name: u.name, status },
      ip: clientIp(req),
    });
    return ok(res, { updated: true });
  }),
);

router.post(
  '/users/:id/reset-password',
  requireSuperAdmin,
  asyncRoute(async (req, res) => {
    const u = await queryOne('SELECT id, name, email FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw notFound('User not found');

    const temp = `Pazo${randomToken(3).toUpperCase()}1`;
    await execute(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [await hashPassword(temp), u.id],
    );
    await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [u.id]);
    await recordAudit({
      actor: req.user,
      action: 'admin.user_password_reset',
      resourceType: 'user',
      resourceId: u.id,
      ip: clientIp(req),
    });
    return ok(res, { temporary_password: temp, email: u.email });
  }),
);

/* ================================================================== */
/* API LOGS + AUDIT LOG                                                */
/* ================================================================== */
router.get(
  '/api-logs',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count] = await Promise.all([
      query(
        `SELECT l.*, b.name AS business_name FROM api_request_log l
           LEFT JOIN businesses b ON b.id = l.business_id
          ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset],
      ),
      queryOne('SELECT COUNT(*) AS n FROM api_request_log'),
    ]);
    return ok(res, paged(rows, Number(count.n), page, limit));
  }),
);

router.get(
  '/audit-log',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const where = [];
    const params = [];
    if (req.query.action) {
      where.push('action LIKE ?');
      params.push(`%${req.query.action}%`);
    }
    if (req.query.actor) {
      where.push('actor_name LIKE ?');
      params.push(`%${req.query.actor}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      query(
        `SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`, params),
    ]);

    if (req.query.format === 'csv') return sendCsv(res, 'pazo-audit-log', rows);
    return ok(res, paged(rows, Number(count.n), page, limit));
  }),
);

/* ================================================================== */
/* Notifications for admins                                            */
/* ================================================================== */
router.get(
  '/notifications',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const [rows, count, unread] = await Promise.all([
      query(
        'SELECT id, type, title, message, data, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
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
  '/notifications/read-all',
  asyncRoute(async (req, res) => {
    const r = await execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id],
    );
    return ok(res, { marked: r.affectedRows });
  }),
);

export default router;
