import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { queryOne } from '../db/pool.js';
import { unauthorized, forbidden } from '../utils/http.js';

export const PARTNER_ROLES = ['individual', 'institution'];
export const ADMIN_ROLES = ['admin', 'super_admin'];
export const BUSINESS_ROLES = ['business_owner'];

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl },
  );
}

export function signTempToken(payload, ttl = '10m') {
  return jwt.sign({ ...payload, temp: true }, env.jwt.accessSecret, { expiresIn: ttl });
}

export function verifyTempToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret);
    if (!decoded.temp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Require a valid access token and load the user onto req.user. */
export async function requireAuth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized('Sign in to continue');

    let decoded;
    try {
      decoded = jwt.verify(token, env.jwt.accessSecret);
    } catch (err) {
      throw unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session');
    }
    if (decoded.temp) throw unauthorized('Invalid session');

    const user = await queryOne(
      `SELECT id, email, phone, role, status, name, avatar_color, has_avatar, created_at
         FROM users WHERE id = ? LIMIT 1`,
      [decoded.sub],
    );
    if (!user) throw unauthorized('Account no longer exists');
    if (user.status === 'suspended')
      throw forbidden('This account is suspended. Contact Pazo support.');
    if (user.status === 'deactivated') throw forbidden('This account is closed.');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Restrict a route to a set of roles. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized('Sign in to continue'));
  if (!roles.includes(req.user.role))
    return next(forbidden('Your account cannot access this area'));
  next();
};

/** Attach req.partner for individual/institution routes. */
export async function loadPartner(req, res, next) {
  try {
    const partner = await queryOne(
      `SELECT p.*, b.name AS business_name, b.commission_rate AS business_commission_rate,
              b.signup_url_template, b.slug AS business_slug
         FROM partners p
         JOIN businesses b ON b.id = p.business_id
        WHERE p.user_id = ?
        ORDER BY p.created_at ASC LIMIT 1`,
      [req.user.id],
    );
    if (!partner) return next(forbidden('No partner profile is linked to this account'));
    if (partner.status === 'suspended')
      return next(forbidden('Your partner account is suspended. Contact Pazo support.'));
    req.partner = partner;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attach req.business for business-owner routes (owner or team member). */
export async function loadBusiness(req, res, next) {
  try {
    const business = await queryOne(
      `SELECT b.*, bm.access AS member_access, bm.is_owner
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id
        WHERE bm.user_id = ?
        ORDER BY bm.is_owner DESC, bm.created_at ASC LIMIT 1`,
      [req.user.id],
    );
    if (!business) return next(forbidden('No business is linked to this account'));
    if (business.status === 'suspended')
      return next(forbidden('This business account is suspended.'));
    req.business = business;
    next();
  } catch (err) {
    next(err);
  }
}

/** Block writes for read-only business team members. */
export function requireBusinessWrite(req, res, next) {
  if (req.business?.member_access === 'read_only')
    return next(forbidden('Your access to this dashboard is read-only'));
  next();
}

/** Only super admins may change platform-wide configuration. */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin')
    return next(forbidden('Only a Pazo super admin can change this'));
  next();
}
