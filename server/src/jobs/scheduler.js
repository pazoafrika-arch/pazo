import { query } from '../db/pool.js';
import { purgeExpiredOtps } from '../services/otp.js';
import { getSetting } from '../services/settings.js';

/**
 * Lightweight in-process scheduler. It ticks hourly and runs the jobs that are
 * due, which is enough for a single-instance deployment. If the platform is
 * ever run on more than one node, move these to a single worker or a cron
 * service so a job cannot run twice.
 */

const HOUR = 60 * 60 * 1000;
// ClickPesa accepts one payout creation per merchant per minute, so the payout
// worker ticks on its own faster schedule rather than with the hourly jobs.
const PAYOUT_TICK_MS = 70 * 1000;
let timer = null;
let payoutTimer = null;
let payoutRunning = false;

async function cleanupJob() {
  try {
    const removed = await purgeExpiredOtps();
    if (removed) console.log(`[pazo:jobs] cleared ${removed} expired OTP rows`);

    const { affectedRows } = await query(
      'DELETE FROM refresh_tokens WHERE expires_at < UTC_TIMESTAMP() OR (revoked = 1 AND created_at < (UTC_TIMESTAMP() - INTERVAL 7 DAY))',
    ).then((r) => ({ affectedRows: r.affectedRows ?? 0 }));
    if (affectedRows) console.log(`[pazo:jobs] cleared ${affectedRows} stale sessions`);
  } catch (err) {
    console.error('[pazo:jobs] cleanup failed:', err.message);
  }
}

/**
 * Institution payouts are due on the configured day of the month. Rather than
 * moving money without a human, this flags the batch for the admin and notifies
 * the team, matching PRD 5.7 where an admin triggers the batch.
 */
async function payoutReminderJob() {
  try {
    const payoutDay = Number(await getSetting('institution_payout_day', 1));
    const now = new Date();
    if (now.getUTCDate() !== payoutDay || now.getUTCHours() !== 6) return;

    const due = await query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ip.accumulated_balance_tzs),0) AS total
         FROM partners p
         JOIN institution_profiles ip ON ip.user_id = p.user_id
        WHERE p.partner_type = 'institution' AND p.status = 'active'
          AND ip.accumulated_balance_tzs > 0`,
    );
    const count = Number(due[0]?.n || 0);
    if (!count) return;

    const total = Number(due[0].total);
    const admins = await query(
      "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'",
    );
    const { notifyMany } = await import('../services/notifications.js');
    await notifyMany(
      admins.map((a) => a.id),
      'custom',
      {
        title: 'Monthly payouts are due',
        body: `${count} institution${count === 1 ? '' : 's'} are due a payout totalling TZS ${total.toLocaleString('en-US')}. Open Monthly Payouts to process the batch.`,
      },
    );
    console.log(`[pazo:jobs] payout reminder sent for ${count} institutions`);
  } catch (err) {
    console.error('[pazo:jobs] payout reminder failed:', err.message);
  }
}

async function tick() {
  await cleanupJob();
  await payoutReminderJob();
}

/**
 * Drain one payout per tick and reconcile anything that has gone quiet.
 * The running flag stops a slow gateway call from overlapping the next tick.
 */
async function payoutTick() {
  if (payoutRunning) return;
  payoutRunning = true;
  try {
    const { drainPayoutQueue, reconcileStalePayouts, reconcileStaleTopups } = await import(
      '../services/payments.js'
    );

    const sent = await drainPayoutQueue();
    if (sent?.sent) console.log(`[pazo:payouts] sent 1 payout (${sent.withdrawal_id})`);

    // Reconcile roughly every fifth tick so status polling stays light.
    if (Math.random() < 0.2) {
      const [payouts, topups] = await Promise.all([
        reconcileStalePayouts(),
        reconcileStaleTopups(),
      ]);
      if (payouts.resolved || topups.resolved) {
        console.log(
          `[pazo:payouts] reconciled ${payouts.resolved} payouts, ${topups.resolved} top-ups`,
        );
      }
    }
  } catch (err) {
    console.error('[pazo:payouts] worker failed:', err.message);
  } finally {
    payoutRunning = false;
  }
}

export function startScheduledJobs() {
  if (timer) return;
  // First tick a minute after boot so startup stays fast.
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, HOUR);
  timer.unref();

  setTimeout(payoutTick, 15_000).unref();
  payoutTimer = setInterval(payoutTick, PAYOUT_TICK_MS);
  payoutTimer.unref();

  console.log('[pazo:jobs] scheduler started (hourly jobs, payout worker every 70s)');
}

export function stopScheduledJobs() {
  if (timer) clearInterval(timer);
  if (payoutTimer) clearInterval(payoutTimer);
  timer = null;
  payoutTimer = null;
}
