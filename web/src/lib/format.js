/**
 * Display helpers. Money is always integer TZS, so it is grouped but never
 * given decimals — showing "TZS 30,840.00" would imply a precision that the
 * platform does not use.
 */

export function tzs(amount, { compact = false, sign = false } = {}) {
  const n = Number(amount || 0);
  if (compact && Math.abs(n) >= 1_000_000)
    return `${sign && n > 0 ? '+' : ''}TZS ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (compact && Math.abs(n) >= 10_000)
    return `${sign && n > 0 ? '+' : ''}TZS ${Math.round(n / 1000)}K`;
  const formatted = Math.abs(n).toLocaleString('en-US');
  const prefix = n < 0 ? '-' : sign && n > 0 ? '+' : '';
  return `${prefix}TZS ${formatted}`;
}

/** Just the grouped number, for tables where the column header says TZS. */
export const num = (n) => Number(n || 0).toLocaleString('en-US');

export const pct = (n, digits = 1) => `${Number(n || 0).toFixed(digits)}%`;

export const ratePct = (rate) => {
  const value = Number(rate || 0) * 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, '')}%`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function date(value, { withYear = true } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

export function time(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export const dateTime = (value) => (value ? `${date(value)} · ${time(value)}` : '—');

export function monthLabel(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'string' && value.length === 7 ? `${value}-01` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString('en-GB', { month: 'long' })} ${d.getFullYear()}`;
}

/** "2 hours ago" style, falling back to a date beyond a week. */
export function relative(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.floor((Date.now() - then) / 1000);

  if (secs < 45) return 'Just now';
  if (secs < 90) return 'A minute ago';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date(value);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** 0754 892 001 from +255754892001. */
export function phone(value) {
  if (!value) return '—';
  const local = String(value).replace(/^\+255/, '0');
  if (local.length !== 10) return value;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** Greeting that matches the time of day the user is actually in. */
export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Status pill styling, shared by every table and detail panel. */
export function statusTone(status) {
  const map = {
    paid: 'green',
    completed: 'green',
    active: 'green',
    approved: 'green',
    pending: 'amber',
    processing: 'amber',
    queued: 'amber',
    upcoming: 'teal',
    referred: 'teal',
    failed: 'red',
    suspended: 'red',
    declined: 'red',
    inactive: 'gray',
    deactivated: 'gray',
    resolved: 'blue',
    read_only: 'blue',
  };
  return map[status] || 'gray';
}

export function statusLabel(status) {
  const map = {
    paid: 'Paid',
    pending: 'Pending',
    failed: 'Failed',
    resolved: 'Resolved',
    processing: 'Processing',
    completed: 'Completed',
    queued: 'Queued',
    upcoming: 'Upcoming',
    active: 'Active',
    referred: 'Referred',
    inactive: 'Inactive',
    suspended: 'Suspended',
    deactivated: 'Closed',
    approved: 'Approved',
    declined: 'Declined',
    first_purchase: 'First purchase',
    topup: 'Top-up',
    individual: 'Individual',
    institution: 'Organisation',
  };
  return map[status] || status;
}

/** Copy to clipboard with a fallback for browsers without the async API. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const okay = document.execCommand('copy');
      el.remove();
      return okay;
    } catch {
      return false;
    }
  }
}
