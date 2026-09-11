import express from 'express';
import { execute, queryOne } from '../db/pool.js';
import { asyncRoute, badRequest, ok, fail } from '../utils/http.js';
import { sha256, uuid, hashIp } from '../utils/crypto.js';
import { normaliseCode, buildReferralLink } from '../utils/format.js';
import { processTransaction } from '../services/commissions.js';
import { notify } from '../services/notifications.js';
import { clientIp } from '../services/audit.js';

const router = express.Router();

/* ------------------------------------------------------------------ */
/* API key auth + request logging (spec 6.6)                           */
/* ------------------------------------------------------------------ */

const SENSITIVE_KEYS = new Set(['password', 'api_key', 'authorization']);
const scrub = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
};

/**
 * Log every integration call so Pazo and The Travela can reconcile.
 * Wraps res.json to capture the response body without changing handlers.
 */
function logIntegrationCall(req, res, next) {
  const startedAt = Date.now();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    execute(
      `INSERT INTO api_request_log
         (business_id, endpoint, method, status_code, request_body, response_body, duration_ms, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.business?.id ?? null,
        req.baseUrl + req.path,
        req.method,
        res.statusCode,
        JSON.stringify(scrub(req.body)),
        JSON.stringify(body),
        Date.now() - startedAt,
        clientIp(req),
      ],
    ).catch((err) => console.error('[pazo] api log failed:', err.message));
    return originalJson(body);
  };
  next();
}

async function requireApiKey(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!key) return fail(res, 401, 'Invalid API key');

    const business = await queryOne(
      "SELECT * FROM businesses WHERE api_key_hash = ? AND status = 'active' LIMIT 1",
      [sha256(key)],
    );
    if (!business) return fail(res, 401, 'Invalid API key');

    req.business = business;
    next();
  } catch (err) {
    next(err);
  }
}

router.use(logIntegrationCall);

/* ------------------------------------------------------------------ */
/* POST /integrations/referrals/register                               */
/* ------------------------------------------------------------------ */
router.post(
  '/referrals/register',
  requireApiKey,
  asyncRoute(async (req, res) => {
    const code = normaliseCode(req.body?.referral_code);
    const touristId = String(req.body?.tourist_id || '').trim();

    if (!code) throw badRequest('referral_code is required');
    if (!touristId) throw badRequest('tourist_id is required');

    const partner = await queryOne(
      `SELECT p.*, u.name, u.id AS user_id
         FROM partners p JOIN users u ON u.id = p.user_id
        WHERE p.referral_code = ? AND p.business_id = ? AND p.status = 'active'
        LIMIT 1`,
      [code, req.business.id],
    );
    if (!partner) return fail(res, 404, 'Referral code not found or inactive');

    const existing = await queryOne(
      'SELECT id, partner_id FROM referrals WHERE business_id = ? AND tourist_external_id = ? LIMIT 1',
      [req.business.id, touristId],
    );
    if (existing) {
      // First code wins: an existing link is never reassigned.
      return ok(res, {
        message: 'Tourist already linked — referral unchanged',
        partner_id: existing.partner_id,
      });
    }

    const referralId = uuid();
    await execute(
      `INSERT INTO referrals (id, partner_id, business_id, tourist_external_id, status)
       VALUES (?, ?, ?, ?, 'referred')`,
      [referralId, partner.id, req.business.id, touristId],
    );
    await execute(
      'UPDATE partners SET total_referrals = total_referrals + 1, last_active_at = UTC_TIMESTAMP() WHERE id = ?',
      [partner.id],
    );
    await notify({ userId: partner.user_id, type: 'new_referral', data: { referral_id: referralId } });

    return ok(res, {
      partner_id: partner.id,
      partner_name: partner.name,
      commission_rate: Number(partner.commission_rate_override ?? req.business.commission_rate),
      referral_id: referralId,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /integrations/transactions                                     */
/* ------------------------------------------------------------------ */
router.post(
  '/transactions',
  requireApiKey,
  asyncRoute(async (req, res) => {
    const {
      tourist_id,
      amount_tzs,
      bundle_type,
      transaction_type = 'first_purchase',
      transaction_reference,
      payment_confirmed_at,
    } = req.body || {};

    const touristId = String(tourist_id || '').trim();
    const amount = Math.floor(Number(amount_tzs));
    const reference = String(transaction_reference || '').trim();

    if (!touristId) throw badRequest('tourist_id is required');
    if (!Number.isFinite(amount) || amount <= 0)
      throw badRequest('amount_tzs must be a positive integer number of shillings');
    if (!reference) throw badRequest('transaction_reference is required');
    if (!['first_purchase', 'topup'].includes(transaction_type))
      throw badRequest("transaction_type must be 'first_purchase' or 'topup'");

    const result = await processTransaction({
      business: req.business,
      touristId,
      amountTzs: amount,
      bundleType: bundle_type ? String(bundle_type).slice(0, 120) : null,
      transactionType: transaction_type,
      transactionReference: reference,
      paymentConfirmedAt: payment_confirmed_at || null,
    });

    if (result.duplicate) {
      return ok(res, {
        commission_tzs: result.commission_tzs,
        platform_fee_tzs: result.platform_fee_tzs,
        commission_status: result.commission_status,
        message: 'Transaction already recorded — no change',
        transaction_id: result.transaction_id,
      });
    }
    if (result.noReferral) {
      return ok(res, {
        commission_tzs: 0,
        message: 'No referral linked to this tourist',
        transaction_id: result.transaction_id,
      });
    }

    const payload = {
      commission_tzs: result.commission_tzs,
      platform_fee_tzs: result.platform_fee_tzs,
      commission_status: result.commission_status,
      transaction_id: result.transaction_id,
      partner_id: result.partner_id,
    };
    if (result.commission_status === 'pending') payload.reason = result.reason;

    return ok(res, payload);
  }),
);

/* ------------------------------------------------------------------ */
/* GET /integrations/verify - lets an integrator test their key        */
/* ------------------------------------------------------------------ */
router.get(
  '/verify',
  requireApiKey,
  asyncRoute(async (req, res) =>
    ok(res, {
      valid: true,
      business_name: req.business.name,
      commission_rate: Number(req.business.commission_rate),
      platform_fee_rate: Number(req.business.platform_fee_rate),
      wallet_balance_tzs: Number(req.business.wallet_balance_tzs),
    }),
  ),
);

/* ------------------------------------------------------------------ */
/* GET /r/:code - public click tracker, redirects to the signup page   */
/* ------------------------------------------------------------------ */
export const clickRouter = express.Router();

clickRouter.get(
  '/:code',
  asyncRoute(async (req, res) => {
    const code = normaliseCode(req.params.code);
    const partner = await queryOne(
      `SELECT p.id, p.status, b.signup_url_template
         FROM partners p JOIN businesses b ON b.id = p.business_id
        WHERE p.referral_code = ? LIMIT 1`,
      [code],
    );

    if (!partner || partner.status !== 'active') {
      return res.redirect(302, 'https://thetravela.com');
    }

    // Fire-and-forget: a slow analytics write must never delay the redirect.
    execute(
      'INSERT INTO referral_clicks (partner_id, source, user_agent, ip_hash) VALUES (?, ?, ?, ?)',
      [
        partner.id,
        String(req.query.s || 'link').slice(0, 50),
        (req.headers['user-agent'] || '').slice(0, 250),
        hashIp(clientIp(req)),
      ],
    )
      .then(() =>
        execute('UPDATE partners SET total_clicks = total_clicks + 1 WHERE id = ?', [partner.id]),
      )
      .catch((err) => console.error('[pazo] click log failed:', err.message));

    return res.redirect(302, buildReferralLink(partner.signup_url_template, code));
  }),
);

export default router;
