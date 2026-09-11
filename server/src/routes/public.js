import express from 'express';
import { query, queryOne } from '../db/pool.js';
import { asyncRoute, ok } from '../utils/http.js';
import { getSetting } from '../services/settings.js';

const router = express.Router();

/**
 * Content and configuration the marketing site and auth screens need before
 * anyone signs in. Everything here is editable from the admin CMS screen.
 */
router.get(
  '/content',
  asyncRoute(async (req, res) => {
    const rows = await query(
      'SELECT content_key, content_value, value_type, group_name FROM cms_content ORDER BY sort_order',
    );

    const content = {};
    for (const r of rows) {
      content[r.content_key] =
        r.value_type === 'json'
          ? (() => {
              try {
                return JSON.parse(r.content_value);
              } catch {
                return null;
              }
            })()
          : r.content_value;
    }

    const [supportEmail, supportPhone, selfSignup, maintenance, platformName] = await Promise.all([
      getSetting('support_email', 'partners@pazo.co.tz'),
      getSetting('support_phone', '+255 754 000 000'),
      getSetting('partner_self_signup', true),
      getSetting('maintenance_mode', false),
      getSetting('platform_name', 'Pazo'),
    ]);

    const business = await queryOne(
      "SELECT name, website FROM businesses WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
    );

    return ok(res, {
      content,
      config: {
        platform_name: platformName,
        support_email: supportEmail,
        support_phone: supportPhone,
        self_signup_open: !!selfSignup,
        maintenance_mode: !!maintenance,
        business_name: business?.name || 'The Travela',
        business_website: business?.website || 'thetravela.com',
      },
    });
  }),
);

/** Public counters used as social proof on the landing page. */
router.get(
  '/stats',
  asyncRoute(async (req, res) => {
    const row = await queryOne(
      `SELECT
        (SELECT COUNT(*) FROM partners WHERE status = 'active') AS partners,
        (SELECT COUNT(*) FROM referrals) AS referrals,
        (SELECT COALESCE(SUM(commission_tzs),0) FROM transactions WHERE commission_status = 'paid') AS paid`,
    );
    return ok(res, {
      active_partners: Number(row.partners),
      total_referrals: Number(row.referrals),
      commissions_paid_tzs: Number(row.paid),
    });
  }),
);

/** Industry options for the organisation application form. */
router.get('/industries', (req, res) =>
  ok(res, {
    items: [
      { value: 'Hospitality', label: 'Hospitality — hotel, lodge, or resort' },
      { value: 'Transport', label: 'Transport — airline, transfer, or taxi' },
      { value: 'Tourism', label: 'Tourism — tour operator or safari company' },
      { value: 'Government', label: 'Government or tourism board' },
      { value: 'Travel agency', label: 'Travel agency or booking platform' },
      { value: 'Other', label: 'Other travel-adjacent industry' },
    ],
  }),
);

export default router;
