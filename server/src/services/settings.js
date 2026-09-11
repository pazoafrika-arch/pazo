import { execute, query, queryOne } from '../db/pool.js';

/**
 * Platform configuration (PRD 5.9). Values live in `platform_settings` and are
 * cached in-process for a short window so hot paths do not hit the database.
 */

const CACHE_TTL_MS = 15_000;
let cache = { at: 0, map: new Map() };

function coerce(value, type) {
  switch (type) {
    case 'int':
      return parseInt(value, 10);
    case 'decimal':
      return Number(value);
    case 'bool':
      return value === 'true' || value === '1';
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    default:
      return value;
  }
}

async function refresh() {
  const rows = await query('SELECT setting_key, setting_value, value_type FROM platform_settings');
  const map = new Map();
  for (const r of rows) map.set(r.setting_key, coerce(r.setting_value, r.value_type));
  cache = { at: Date.now(), map };
  return map;
}

export async function getSetting(key, fallback = null) {
  if (Date.now() - cache.at > CACHE_TTL_MS) await refresh();
  const value = cache.map.get(key);
  return value === undefined || value === null ? fallback : value;
}

export async function allSettings() {
  return query(
    `SELECT setting_key, setting_value, value_type, category, label, description, updated_at
       FROM platform_settings ORDER BY category, label`,
  );
}

export async function updateSettings(entries, userId) {
  for (const [key, value] of Object.entries(entries)) {
    const existing = await queryOne(
      'SELECT setting_key FROM platform_settings WHERE setting_key = ? LIMIT 1',
      [key],
    );
    if (!existing) continue;
    await execute(
      'UPDATE platform_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
      [String(value), userId, key],
    );
  }
  cache.at = 0;
  return allSettings();
}

export const DEFAULT_SETTINGS = [
  ['min_withdrawal_tzs', '5000', 'int', 'payouts', 'Minimum withdrawal (individual)', 'An individual partner cannot withdraw less than this amount.'],
  ['max_withdrawal_tzs', '3000000', 'int', 'payouts', 'Maximum withdrawal per request', 'Upper limit on a single withdrawal request.'],
  ['institution_payout_day', '1', 'int', 'payouts', 'Institution payout day', 'Day of the month Pazo processes institution payouts.'],
  ['otp_expiry_minutes', '5', 'int', 'security', 'OTP expiry (minutes)', 'How long a verification code stays valid.'],
  ['session_duration_days', '30', 'int', 'security', 'Session duration (days)', 'How long a signed-in session lasts without activity.'],
  ['max_failed_logins', '5', 'int', 'security', 'Failed logins before lock', 'Attempts allowed before an account is locked.'],
  ['login_lock_minutes', '30', 'int', 'security', 'Account lock duration (minutes)', 'How long an account stays locked after too many failed logins.'],
  ['default_commission_rate', '0.08', 'decimal', 'commissions', 'Default commission rate', 'Applied to a new business unless overridden.'],
  ['default_platform_fee_rate', '0.01', 'decimal', 'commissions', 'Default platform fee rate', 'Share of each purchase retained by Pazo.'],
  ['referral_code_min_length', '4', 'int', 'referrals', 'Referral code minimum length', 'Shortest code a partner may choose.'],
  ['referral_code_max_length', '10', 'int', 'referrals', 'Referral code maximum length', 'Longest code a partner may choose.'],
  ['support_email', 'partners@pazo.co.tz', 'string', 'general', 'Support email', 'Shown to partners across the platform.'],
  ['support_phone', '+255 754 000 000', 'string', 'general', 'Support phone', 'Shown on help screens.'],
  ['platform_name', 'Pazo', 'string', 'general', 'Platform name', 'Used in notifications and page titles.'],
  ['partner_self_signup', 'true', 'bool', 'general', 'Allow individual self-signup', 'When off, individuals cannot create their own accounts.'],
  ['maintenance_mode', 'false', 'bool', 'general', 'Maintenance mode', 'Shows a maintenance notice and blocks partner sign-in.'],
];
