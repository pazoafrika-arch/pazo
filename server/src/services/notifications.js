import { execute, query } from '../db/pool.js';
import { uuid } from '../utils/crypto.js';

/**
 * Notification copy comes from PRD 2.8 (individual) and 3.4 (institution).
 * Delivery outside the app (SMS / email / WhatsApp) is stubbed here: the
 * message is logged and recorded. Swapping in a real gateway means replacing
 * only `deliverExternal`.
 */

const money = (n) => `TZS ${Number(n || 0).toLocaleString('en-US')}`;

export const NOTIFICATION_COPY = {
  commission_paid: ({ amount, bundle, when }) => ({
    title: 'Commission earned',
    message: `You earned ${money(amount)} on a ${bundle || 'data bundle'} — ${when}`,
  }),
  commission_pending: ({ amount }) => ({
    title: 'Commission pending',
    message: `A commission of ${money(amount)} is pending. It will be paid when available.`,
  }),
  commission_accrued: ({ amount, when }) => ({
    title: 'Commission added',
    message: `Commission of ${money(amount)} added to your monthly balance — ${when}`,
  }),
  new_referral: () => ({
    title: 'New referral',
    message: 'Someone signed up using your referral code.',
  }),
  withdrawal_complete: ({ amount }) => ({
    title: 'Withdrawal sent',
    message: `${money(amount)} has been sent to your mobile money account.`,
  }),
  withdrawal_requested: ({ amount }) => ({
    title: 'Withdrawal processing',
    message: `Your withdrawal of ${money(amount)} is being processed.`,
  }),
  withdrawal_failed: ({ amount, reason }) => ({
    title: 'Withdrawal failed',
    message: `Your withdrawal of ${money(amount)} could not be completed${reason ? `: ${reason}` : ''}. The amount has been returned to your balance.`,
  }),
  monthly_payout: ({ amount, when }) => ({
    title: 'Monthly payout sent',
    message: `Your monthly payout of ${money(amount)} has been sent to your account — ${when}`,
  }),
  welcome: ({ name, code }) => ({
    title: 'Welcome to Pazo',
    message: `Welcome to Pazo, ${name}! Your referral code is ${code}.`,
  }),
  account_approved: ({ url }) => ({
    title: 'Your partner account is ready',
    message: `Your Pazo partner account is ready. Log in here: ${url}`,
  }),
  low_wallet_balance: ({ balance, threshold }) => ({
    title: 'Wallet balance is low',
    message: `Your wallet balance is ${money(balance)}, below your alert threshold of ${money(threshold)}. Top up to keep paying commissions.`,
  }),
  commission_unpaid_alert: ({ amount, partner }) => ({
    title: 'Commission could not be paid',
    message: `A commission of ${money(amount)} for ${partner} is pending because the wallet balance is insufficient.`,
  }),
  announcement: ({ title, body }) => ({ title, message: body }),
  custom: ({ title, body }) => ({ title: title || 'Message from Pazo', message: body }),
};

/**
 * Create an in-app notification.
 * Pass `tx` (a transaction helper from db/pool) to enlist in a transaction.
 */
export async function notify(
  { userId, type, params = {}, data = null },
  tx = null,
) {
  const build = NOTIFICATION_COPY[type] || NOTIFICATION_COPY.custom;
  const { title, message } = build(params);
  const id = uuid();
  const sql = `INSERT INTO notifications (id, user_id, type, title, message, data)
               VALUES (?, ?, ?, ?, ?, ?)`;
  const args = [id, userId, type, title, message, data ? JSON.stringify(data) : null];
  if (tx) await tx.exec(sql, args);
  else await execute(sql, args);
  return { id, title, message };
}

/** Create the same notification for many users (bulk announcements). */
export async function notifyMany(userIds, type, params = {}, data = null) {
  if (!userIds.length) return 0;
  const build = NOTIFICATION_COPY[type] || NOTIFICATION_COPY.custom;
  const { title, message } = build(params);
  const values = [];
  const placeholders = userIds
    .map((uid) => {
      values.push(uuid(), uid, type, title, message, data ? JSON.stringify(data) : null);
      return '(?, ?, ?, ?, ?, ?)';
    })
    .join(', ');
  await execute(
    `INSERT INTO notifications (id, user_id, type, title, message, data) VALUES ${placeholders}`,
    values,
  );
  return userIds.length;
}

/**
 * External delivery stub. In production this calls the SMS gateway / mail
 * provider; in the demo it records intent so the admin send-history is honest.
 */
export async function deliverExternal({ channel, to, subject, body }) {
  console.log(`[pazo:${channel}] -> ${to}: ${subject ? `${subject} | ` : ''}${body}`);
  return { delivered: true, channel, to };
}

export async function unreadCount(userId) {
  const rows = await query(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId],
  );
  return Number(rows[0]?.n || 0);
}
