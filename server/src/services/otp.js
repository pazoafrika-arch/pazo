import env from '../config/env.js';
import { execute, query, queryOne } from '../db/pool.js';
import { generateOtp, sha256, uuid } from '../utils/crypto.js';
import { badRequest, tooMany } from '../utils/http.js';
import { toMysqlDateTime } from '../utils/format.js';
import { deliverExternal } from './notifications.js';
import { getSetting } from './settings.js';

const RESEND_WINDOW_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;

/**
 * Issue an OTP for an identifier (phone in E.164, or email).
 * Spec 2.2: 6 digits, 5-minute expiry, 3 attempts, resend after 60s.
 */
export async function issueOtp({ identifier, channel, purpose }) {
  const expiryMinutes = await getSetting('otp_expiry_minutes', env.otp.expiryMinutes);

  const recent = await queryOne(
    `SELECT created_at FROM otp_codes
      WHERE identifier = ? AND purpose = ?
      ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose],
  );
  if (recent) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < RESEND_WINDOW_SECONDS) {
      throw tooMany(
        `Please wait ${Math.ceil(RESEND_WINDOW_SECONDS - elapsed)} seconds before requesting another code`,
      );
    }
  }

  const hourly = await queryOne(
    `SELECT COUNT(*) AS n FROM otp_codes
      WHERE identifier = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)`,
    [identifier],
  );
  if (Number(hourly?.n || 0) >= MAX_SENDS_PER_HOUR) {
    throw tooMany('Too many verification codes requested. Try again in an hour.');
  }

  // Any earlier unconsumed code for this purpose is void.
  await execute(
    'UPDATE otp_codes SET consumed = 1 WHERE identifier = ? AND purpose = ? AND consumed = 0',
    [identifier, purpose],
  );

  const code = generateOtp();
  const expiresAt = toMysqlDateTime(new Date(Date.now() + expiryMinutes * 60_000));
  await execute(
    `INSERT INTO otp_codes (id, identifier, channel, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), identifier, channel, purpose, sha256(code), expiresAt],
  );

  await deliverExternal({
    channel,
    to: identifier,
    subject: 'Your Pazo verification code',
    body: `${code} is your Pazo verification code. It expires in ${expiryMinutes} minutes.`,
  });

  return {
    sent: true,
    channel,
    expires_in_seconds: expiryMinutes * 60,
    resend_after_seconds: RESEND_WINDOW_SECONDS,
    // Development convenience only - lets the UI show the code without an SMS gateway.
    dev_code: env.otp.devEcho && !env.isProd ? code : undefined,
  };
}

/** Verify and consume an OTP. Throws a friendly error when it fails. */
export async function verifyOtp({ identifier, purpose, code }) {
  const row = await queryOne(
    `SELECT * FROM otp_codes
      WHERE identifier = ? AND purpose = ? AND consumed = 0
      ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose],
  );
  if (!row) throw badRequest('Request a new verification code');

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await execute('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id]);
    throw badRequest('That code has expired. Request a new one.');
  }

  const maxAttempts = env.otp.maxAttempts;
  if (row.attempts >= maxAttempts) {
    await execute('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id]);
    throw tooMany('Too many incorrect attempts. Request a new code.');
  }

  if (row.code_hash !== sha256(String(code).trim())) {
    await execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    const left = maxAttempts - (row.attempts + 1);
    throw badRequest(
      left > 0
        ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'That code is not correct. Request a new code.',
    );
  }

  await execute('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id]);
  return true;
}

/** Housekeeping: drop OTP rows older than a day. */
export async function purgeExpiredOtps() {
  const res = await execute(
    'DELETE FROM otp_codes WHERE created_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)',
  );
  return res.affectedRows;
}

export async function otpDebugList(identifier) {
  return query(
    'SELECT purpose, channel, attempts, consumed, expires_at, created_at FROM otp_codes WHERE identifier = ? ORDER BY created_at DESC LIMIT 5',
    [identifier],
  );
}
