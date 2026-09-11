import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import env from '../config/env.js';

export const uuid = () => uuidv4();

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export const hashPassword = (plain) => bcrypt.hash(plain, env.security.bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Cryptographically random 6-digit OTP, per spec 8.2. */
export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A business API key. Shown to the user once; only the SHA-256 hash is stored.
 * Format: pazo_live_<32 hex>
 */
export function generateApiKey() {
  const secret = crypto.randomBytes(16).toString('hex');
  const key = `pazo_live_${secret}`;
  return {
    key,
    hash: sha256(key),
    prefix: 'pazo_live',
    lastFour: secret.slice(-4),
  };
}

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('hex');

/** Hash an IP for click analytics without storing the address itself. */
export const hashIp = (ip) => (ip ? sha256(`pazo-click-salt:${ip}`).slice(0, 40) : null);

/** Deterministic pleasant avatar colour from the Pazo palette. */
const AVATAR_COLORS = [
  '#007b84',
  '#0D2137',
  '#2C6E6E',
  '#0F3460',
  '#0E7490',
  '#4338CA',
  '#B45309',
  '#047857',
];
export function avatarColorFor(seed) {
  const n = parseInt(sha256(seed).slice(0, 8), 16);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}
