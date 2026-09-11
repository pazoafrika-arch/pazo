import express from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { execute, queryOne, transaction } from '../db/pool.js';
import {
  asyncRoute,
  badRequest,
  conflict,
  forbidden,
  ok,
  unauthorized,
} from '../utils/http.js';
import {
  avatarColorFor,
  hashPassword,
  randomToken,
  sha256,
  uuid,
  verifyPassword,
} from '../utils/crypto.js';
import {
  buildReferralLink,
  isEmail,
  isValidCode,
  normaliseCode,
  normalisePhone,
  passwordProblem,
  toMysqlDateTime,
} from '../utils/format.js';
import { issueOtp, verifyOtp } from '../services/otp.js';
import { getSetting } from '../services/settings.js';
import { notify } from '../services/notifications.js';
import { recordAudit, clientIp } from '../services/audit.js';
import { signAccessToken, signTempToken, verifyTempToken, requireAuth } from '../middleware/auth.js';

const router = express.Router();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function issueSession(user, req) {
  const refreshToken = randomToken(48);
  const days = await getSetting('session_duration_days', env.jwt.refreshTtlDays);
  const expiresAt = toMysqlDateTime(new Date(Date.now() + days * 86_400_000));

  await execute(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      user.id,
      sha256(refreshToken),
      (req.headers['user-agent'] || '').slice(0, 250),
      clientIp(req),
      expiresAt,
    ],
  );
  await execute(
    'UPDATE users SET last_login_at = UTC_TIMESTAMP(), failed_login_count = 0, locked_until = NULL WHERE id = ?',
    [user.id],
  );

  return {
    access_token: signAccessToken(user),
    refresh_token: refreshToken,
    expires_in: 1800,
    user: publicUser(user),
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatar_color: user.avatar_color,
  };
}

/** Route each role to its home. Keeps redirect logic in one place. */
export function homeForRole(role) {
  switch (role) {
    case 'individual':
      return '/app';
    case 'institution':
      return '/institution';
    case 'business_owner':
      return '/business';
    case 'admin':
    case 'super_admin':
      return '/admin';
    default:
      return '/';
  }
}

async function findUserByIdentifier(identifier) {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) return null;
  if (isEmail(trimmed)) {
    return queryOne('SELECT * FROM users WHERE email = ? LIMIT 1', [trimmed.toLowerCase()]);
  }
  const phone = normalisePhone(trimmed);
  if (!phone) return null;
  return queryOne('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone]);
}

/* ------------------------------------------------------------------ */
/* GET /auth/check-code/:code - referral code availability             */
/* ------------------------------------------------------------------ */
router.get(
  '/check-code/:code',
  asyncRoute(async (req, res) => {
    const code = normaliseCode(req.params.code);
    const min = await getSetting('referral_code_min_length', 4);
    const max = await getSetting('referral_code_max_length', 10);

    if (!/^[A-Z0-9]*$/.test(code))
      return ok(res, { available: false, reason: 'Use letters and numbers only' });
    if (code.length < min)
      return ok(res, { available: false, reason: `At least ${min} characters` });
    if (code.length > max)
      return ok(res, { available: false, reason: `At most ${max} characters` });

    const taken = await queryOne('SELECT id FROM partners WHERE referral_code = ? LIMIT 1', [code]);
    const business = await queryOne(
      "SELECT signup_url_template FROM businesses WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
    );
    return ok(res, {
      available: !taken,
      code,
      reason: taken ? 'That code is already taken' : null,
      preview_link: taken ? null : buildReferralLink(business?.signup_url_template, code),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/request-otp                                              */
/* ------------------------------------------------------------------ */
router.post(
  '/request-otp',
  asyncRoute(async (req, res) => {
    const { phone, email, purpose = 'signup' } = req.body || {};
    const validPurposes = ['signup', 'login', 'reset'];
    if (!validPurposes.includes(purpose)) throw badRequest('Unknown verification purpose');

    let identifier;
    let channel;
    if (phone) {
      identifier = normalisePhone(phone);
      channel = 'sms';
      if (!identifier) throw badRequest('Enter a valid Tanzanian phone number');
    } else if (email) {
      identifier = String(email).trim().toLowerCase();
      channel = 'email';
      if (!isEmail(identifier)) throw badRequest('Enter a valid email address');
    } else {
      throw badRequest('A phone number or email address is required');
    }

    const existing = await queryOne(
      channel === 'sms'
        ? 'SELECT id FROM users WHERE phone = ? LIMIT 1'
        : 'SELECT id FROM users WHERE email = ? LIMIT 1',
      [identifier],
    );

    if (purpose === 'signup' && existing)
      throw conflict(
        channel === 'sms'
          ? 'That phone number already has an account. Sign in instead.'
          : 'That email already has an account. Sign in instead.',
      );
    if (purpose === 'reset' && !existing) {
      // Do not disclose whether an account exists.
      return ok(res, { sent: true, channel, expires_in_seconds: 300 });
    }

    const result = await issueOtp({ identifier, channel, purpose });
    return ok(res, { ...result, identifier });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/verify-otp - returns a temp token                        */
/* ------------------------------------------------------------------ */
router.post(
  '/verify-otp',
  asyncRoute(async (req, res) => {
    const { phone, email, code, purpose = 'signup' } = req.body || {};
    const identifier = phone ? normalisePhone(phone) : String(email || '').trim().toLowerCase();
    if (!identifier) throw badRequest('A phone number or email address is required');
    if (!code) throw badRequest('Enter the 6-digit code');

    await verifyOtp({ identifier, purpose, code });

    return ok(res, {
      verified: true,
      temp_token: signTempToken({ identifier, purpose }),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/register/individual                                      */
/* ------------------------------------------------------------------ */
router.post(
  '/register/individual',
  asyncRoute(async (req, res) => {
    const selfSignup = await getSetting('partner_self_signup', true);
    if (!selfSignup) throw forbidden('Self sign-up is currently closed. Contact Pazo to join.');

    const {
      first_name,
      last_name,
      email,
      phone,
      whatsapp_number,
      password,
      referral_code,
      temp_token,
    } = req.body || {};

    if (!first_name || String(first_name).trim().length < 2)
      throw badRequest('Enter your first name');
    if (!last_name || String(last_name).trim().length < 2) throw badRequest('Enter your last name');

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isEmail(cleanEmail)) throw badRequest('Enter a valid email address');

    const cleanPhone = normalisePhone(phone);
    if (!cleanPhone) throw badRequest('Enter a valid Tanzanian phone number');

    const cleanWhatsapp = whatsapp_number ? normalisePhone(whatsapp_number) : cleanPhone;
    if (!cleanWhatsapp) throw badRequest('Enter a valid WhatsApp number');

    const pwProblem = passwordProblem(password);
    if (pwProblem) throw badRequest(pwProblem);

    const code = normaliseCode(referral_code);
    if (!isValidCode(code))
      throw badRequest('Your referral code must be 4-10 letters or numbers');

    // The phone must have been verified by OTP in step 3.
    const temp = verifyTempToken(temp_token);
    if (!temp || temp.identifier !== cleanPhone || temp.purpose !== 'signup')
      throw badRequest('Verify your phone number before creating the account');

    const [emailTaken, phoneTaken, codeTaken] = await Promise.all([
      queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [cleanEmail]),
      queryOne('SELECT id FROM users WHERE phone = ? LIMIT 1', [cleanPhone]),
      queryOne('SELECT id FROM partners WHERE referral_code = ? LIMIT 1', [code]),
    ]);
    if (emailTaken) throw conflict('That email already has an account');
    if (phoneTaken) throw conflict('That phone number already has an account');
    if (codeTaken) throw conflict('That referral code is taken. Choose another.');

    const business = await queryOne(
      "SELECT * FROM businesses WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
    );
    if (!business) throw badRequest('No partner programme is open right now');

    const fullName = `${String(first_name).trim()} ${String(last_name).trim()}`;
    const userId = uuid();
    const passwordHash = await hashPassword(password);

    await transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO users (id, email, phone, password_hash, role, status, name, avatar_color, phone_verified)
         VALUES (?, ?, ?, ?, 'individual', 'active', ?, ?, 1)`,
        [userId, cleanEmail, cleanPhone, passwordHash, fullName, avatarColorFor(userId)],
      );
      await tx.exec(
        `INSERT INTO individual_profiles
           (id, user_id, first_name, last_name, whatsapp_number, mobile_money_number, mobile_money_verified)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [uuid(), userId, String(first_name).trim(), String(last_name).trim(), cleanWhatsapp, cleanPhone],
      );
      await tx.exec(
        `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, status)
         VALUES (?, ?, ?, 'individual', ?, 'active')`,
        [uuid(), userId, business.id, code],
      );
      await notify(
        {
          userId,
          type: 'welcome',
          params: { name: String(first_name).trim(), code },
        },
        tx,
      );
    });

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    const session = await issueSession(user, req);

    await recordAudit({
      actor: { id: userId, name: fullName, role: 'individual' },
      action: 'individual.signup',
      resourceType: 'user',
      resourceId: userId,
      ip: clientIp(req),
    });

    return ok(
      res,
      {
        ...session,
        referral_code: code,
        referral_link: buildReferralLink(business.signup_url_template, code),
        redirect_to: homeForRole('individual'),
      },
      201,
    );
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/register/institution - application for admin review      */
/* ------------------------------------------------------------------ */
router.post(
  '/register/institution',
  asyncRoute(async (req, res) => {
    const {
      organisation_name,
      industry_type,
      contact_person_name,
      contact_email,
      contact_phone,
      payout_method = 'bank',
      payout_account,
      payout_bank_name,
      notes,
    } = req.body || {};

    if (!organisation_name || String(organisation_name).trim().length < 2)
      throw badRequest('Enter your organisation name');
    if (!contact_person_name || String(contact_person_name).trim().length < 2)
      throw badRequest('Enter a contact person');

    const cleanEmail = String(contact_email || '').trim().toLowerCase();
    if (!isEmail(cleanEmail)) throw badRequest('Enter a valid contact email');

    const cleanPhone = contact_phone ? normalisePhone(contact_phone) : null;
    if (contact_phone && !cleanPhone) throw badRequest('Enter a valid Tanzanian phone number');

    const existingUser = await queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [cleanEmail]);
    if (existingUser) throw conflict('That email already has a Pazo account. Sign in instead.');

    const openApplication = await queryOne(
      "SELECT id FROM institution_applications WHERE contact_email = ? AND status = 'pending' LIMIT 1",
      [cleanEmail],
    );
    if (openApplication)
      throw conflict('We already have an application for this email. Our team is reviewing it.');

    const business = await queryOne(
      "SELECT id FROM businesses WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
    );
    if (!business) throw badRequest('No partner programme is open right now');

    const appId = uuid();
    await execute(
      `INSERT INTO institution_applications
         (id, business_id, organisation_name, industry_type, contact_person_name, contact_email,
          contact_phone, payout_method, payout_account, payout_bank_name, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appId,
        business.id,
        String(organisation_name).trim(),
        industry_type || null,
        String(contact_person_name).trim(),
        cleanEmail,
        cleanPhone,
        payout_method === 'mobile_money' ? 'mobile_money' : 'bank',
        payout_account || null,
        payout_bank_name || null,
        notes || null,
      ],
    );

    // Let every admin know a review is waiting.
    const admins = await queryOne(
      "SELECT GROUP_CONCAT(id) AS ids FROM users WHERE role IN ('admin','super_admin') AND status = 'active'",
    );
    if (admins?.ids) {
      for (const adminId of admins.ids.split(',')) {
        await notify({
          userId: adminId,
          type: 'custom',
          params: {
            title: 'New institution application',
            body: `${String(organisation_name).trim()} applied to join the partner programme.`,
          },
          data: { application_id: appId },
        });
      }
    }

    return ok(
      res,
      {
        submitted: true,
        application_id: appId,
        message:
          'Registration received. Our team reviews applications within 24 hours and will email your login details.',
      },
      201,
    );
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/login                                                    */
/* ------------------------------------------------------------------ */
router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { identifier, email, phone, password } = req.body || {};
    const login = identifier || email || phone;
    if (!login) throw badRequest('Enter your email or phone number');
    if (!password) throw badRequest('Enter your password');

    const user = await findUserByIdentifier(login);
    // Uniform message so the form never reveals which accounts exist.
    const invalid = unauthorized('Those details do not match an account');
    if (!user) throw invalid;

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000);
      throw forbidden(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    if (user.status === 'suspended')
      throw forbidden('This account is suspended. Contact Pazo support.');
    if (user.status === 'deactivated') throw forbidden('This account is closed.');
    if (user.status === 'pending_approval')
      throw forbidden('Your application is still being reviewed.');

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const maxFailed = await getSetting('max_failed_logins', env.security.maxFailedLogins);
      const lockMinutes = await getSetting('login_lock_minutes', env.security.lockMinutes);
      const count = user.failed_login_count + 1;
      if (count >= maxFailed) {
        const until = toMysqlDateTime(new Date(Date.now() + lockMinutes * 60_000));
        await execute('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?', [
          count,
          until,
          user.id,
        ]);
        throw forbidden(
          `Too many attempts. This account is locked for ${lockMinutes} minutes.`,
        );
      }
      await execute('UPDATE users SET failed_login_count = ? WHERE id = ?', [count, user.id]);
      throw invalid;
    }

    const maintenance = await getSetting('maintenance_mode', false);
    if (maintenance && !['admin', 'super_admin'].includes(user.role))
      throw forbidden('Pazo is briefly down for maintenance. Please try again shortly.');

    const session = await issueSession(user, req);
    await recordAudit({
      actor: user,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      ip: clientIp(req),
    });

    return ok(res, { ...session, redirect_to: homeForRole(user.role) });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/refresh                                                  */
/* ------------------------------------------------------------------ */
router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const { refresh_token } = req.body || {};
    if (!refresh_token) throw unauthorized('Session expired. Sign in again.');

    const row = await queryOne(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 LIMIT 1',
      [sha256(refresh_token)],
    );
    if (!row) throw unauthorized('Session expired. Sign in again.');
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
      throw unauthorized('Session expired. Sign in again.');
    }

    const user = await queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [row.user_id]);
    if (!user || user.status !== 'active') throw unauthorized('Session expired. Sign in again.');

    return ok(res, {
      access_token: signAccessToken(user),
      expires_in: 1800,
      user: publicUser(user),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/logout                                                   */
/* ------------------------------------------------------------------ */
router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    const { refresh_token } = req.body || {};
    if (refresh_token) {
      await execute('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [
        sha256(refresh_token),
      ]);
    }
    return ok(res, { signed_out: true });
  }),
);

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */
router.post(
  '/forgot-password',
  asyncRoute(async (req, res) => {
    const { identifier } = req.body || {};
    if (!identifier) throw badRequest('Enter your email or phone number');

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Always answer the same way.
      return ok(res, { sent: true, channel: isEmail(identifier) ? 'email' : 'sms' });
    }

    const useEmail = isEmail(String(identifier).trim());
    const target = useEmail ? user.email : user.phone;
    if (!target) throw badRequest('This account has no verified contact for password reset');

    const result = await issueOtp({
      identifier: target,
      channel: useEmail ? 'email' : 'sms',
      purpose: 'reset',
    });
    return ok(res, { ...result, identifier: target });
  }),
);

router.post(
  '/reset-password',
  asyncRoute(async (req, res) => {
    const { temp_token, password } = req.body || {};
    const temp = verifyTempToken(temp_token);
    if (!temp || temp.purpose !== 'reset') throw badRequest('Verify your code again to continue');

    const pwProblem = passwordProblem(password);
    if (pwProblem) throw badRequest(pwProblem);

    const user = await findUserByIdentifier(temp.identifier);
    if (!user) throw badRequest('We could not find that account');

    const hash = await hashPassword(password);
    await execute(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [hash, user.id],
    );
    // Every existing session is invalidated after a password change.
    await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [user.id]);

    await recordAudit({
      actor: user,
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: user.id,
      ip: clientIp(req),
    });

    return ok(res, { reset: true, redirect_to: '/login' });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /auth/me                                                        */
/* ------------------------------------------------------------------ */
router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    return ok(res, { user: publicUser(req.user), redirect_to: homeForRole(req.user.role) });
  }),
);

/* ------------------------------------------------------------------ */
/* POST /auth/change-password (signed in)                              */
/* ------------------------------------------------------------------ */
router.post(
  '/change-password',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { current_password, new_password } = req.body || {};
    const full = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const valid = await verifyPassword(current_password || '', full.password_hash);
    if (!valid) throw badRequest('Your current password is not correct');

    const pwProblem = passwordProblem(new_password);
    if (pwProblem) throw badRequest(pwProblem);

    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await hashPassword(new_password),
      req.user.id,
    ]);
    await recordAudit({
      actor: req.user,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, { changed: true });
  }),
);

export default router;
