import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  appUrl: process.env.APP_URL || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pazo',
    connectionLimit: num(process.env.DB_POOL, 10),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'pazo-dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'pazo-dev-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtlDays: num(process.env.JWT_REFRESH_TTL_DAYS, 30),
  },

  // In development OTP codes are returned in the API response and printed to the
  // console instead of being sent over SMS/email. Never enable in production.
  otp: {
    expiryMinutes: num(process.env.OTP_EXPIRY_MINUTES, 5),
    maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 3),
    devEcho: (process.env.OTP_DEV_ECHO || 'true') === 'true',
  },

  security: {
    bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
    maxFailedLogins: num(process.env.MAX_FAILED_LOGINS, 5),
    lockMinutes: num(process.env.LOGIN_LOCK_MINUTES, 30),
  },

  /**
   * ClickPesa payment gateway.
   *
   * `checksumKey` is optional on the provider side but should always be set:
   * without it, inbound webhooks cannot be cryptographically verified and the
   * platform falls back to confirming every callback against the gateway API.
   * `webhookIpAllowlist` is a comma-separated list; empty means no IP check.
   */
  clickpesa: {
    baseUrl: process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com/third-parties',
    clientId: process.env.CLICKPESA_CLIENT_ID || '',
    apiKey: process.env.CLICKPESA_API_KEY || '',
    checksumKey: process.env.CLICKPESA_CHECKSUM_KEY || '',
    webhookIpAllowlist: (process.env.CLICKPESA_WEBHOOK_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    get configured() {
      return Boolean(this.clientId && this.apiKey);
    },
  },

  isProd: (process.env.NODE_ENV || 'development') === 'production',
};

export default env;
