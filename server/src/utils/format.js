/**
 * Shared formatting and normalisation helpers.
 * Money is always an integer number of Tanzanian shillings.
 */

/**
 * Normalise a Tanzanian phone number to +255XXXXXXXXX.
 * Accepts 0754 000 000, 255754000000, +255 754 000 000, 754000000.
 * Returns null when the input cannot be a valid TZ mobile number.
 */
export function normalisePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/[^\d+]/g, '').replace(/^\+/, '');
  let local;
  if (digits.startsWith('255')) local = digits.slice(3);
  else if (digits.startsWith('0')) local = digits.slice(1);
  else local = digits;
  if (!/^[67]\d{8}$/.test(local)) return null;
  return `+255${local}`;
}

/** 0754 892 001 style display for a stored +255 number. */
export function displayPhone(e164) {
  if (!e164) return '';
  const local = e164.replace(/^\+255/, '0');
  if (local.length !== 10) return e164;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** Mask a mobile money number for display: +255754892001 -> 0754 *** 001 */
export function maskPhone(e164) {
  if (!e164) return '';
  const local = e164.replace(/^\+255/, '0');
  if (local.length < 7) return '***';
  return `${local.slice(0, 4)} *** ${local.slice(-3)}`;
}

/** Mask a bank or payout account: NMB 0123456789 -> NMB ****6789 */
export function maskAccount(account) {
  if (!account) return '';
  const str = String(account);
  if (str.length <= 4) return `****${str}`;
  return `${str.slice(0, Math.max(0, str.length - 8))}****${str.slice(-4)}`.trim();
}

export const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** Referral codes: A-Z and 0-9 only, 4-10 chars, stored uppercase (spec 2.2). */
export const REFERRAL_CODE_RE = /^[A-Z0-9]{4,10}$/;
export const normaliseCode = (v) => String(v || '').trim().toUpperCase();
export const isValidCode = (v) => REFERRAL_CODE_RE.test(normaliseCode(v));

/**
 * Password policy (spec 2.2): min 8 chars, at least one number and one uppercase.
 * Returns null when valid, otherwise the reason.
 */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8)
    return 'Password must be at least 8 characters';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number';
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter';
  return null;
}

/** Build the referral link for a business + code. */
export function buildReferralLink(template, code) {
  const base = template || 'https://thetravela.com/signup?ref={CODE}';
  return base.includes('{CODE}') ? base.replace('{CODE}', code) : `${base}${code}`;
}

/** Round a commission to whole shillings, never negative. */
export function computeCommission(amountTzs, rate) {
  const value = Math.round(Number(amountTzs) * Number(rate));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** ISO 8601 UTC string, or null. */
export const iso = (d) => (d ? new Date(d).toISOString() : null);

/** First day of the month for a date, as YYYY-MM-DD. */
export function monthStart(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** First day of next month, as YYYY-MM-DD. */
export function nextMonthStart(date = new Date()) {
  const d = new Date(date);
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 11 ? 1 : d.getUTCMonth() + 2;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** Convert any JS date-ish to a MySQL DATETIME string in UTC. */
export function toMysqlDateTime(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Safe slug from a name. */
export const slugify = (v) =>
  String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

/** Initials for an avatar, max two letters. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
