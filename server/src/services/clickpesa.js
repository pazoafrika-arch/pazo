import crypto from 'node:crypto';
import env from '../config/env.js';
import { execute } from '../db/pool.js';

/**
 * ClickPesa client.
 *
 * Contract (docs.clickpesa.com):
 *   Base            https://api.clickpesa.com/third-parties
 *   Token           POST /generate-token          headers: client-id, api-key
 *                   -> { success, token: "Bearer eyJ..." }, valid 1 hour
 *   Collect         POST /payments/initiate-ussd-push-request
 *   Collect status  GET  /payments/{orderReference}
 *   Payout preview  POST /payouts/preview-mobile-money-payout
 *   Payout create   POST /payouts/create-mobile-money-payout
 *   Payout status   GET  /payouts/{orderReference}
 *   Balance         GET  /accounts/balance
 *
 * Two provider rules shape everything downstream:
 *   1. Payout creation is limited to ONE per merchant per 60 seconds, so
 *      payouts are queued and drained by a worker rather than sent inline.
 *   2. orderReference is alphanumeric, max 20 characters, and must be unique
 *      forever. A duplicate returns 409.
 */

const BASE = env.clickpesa.baseUrl;
const TIMEOUT_MS = 20_000;

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

export class GatewayError extends Error {
  constructor(message, { status = null, code = null, body = null, retryable = false } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryable = retryable;
  }
}

/* ------------------------------------------------------------------ */
/* references                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build an orderReference: a prefix, a base36 timestamp and random suffix.
 * Alphanumeric only and always under the 20-character provider limit.
 */
export function makeOrderReference(prefix) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${stamp}${rand}`.slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* checksum                                                            */
/* ------------------------------------------------------------------ */

/** Recursively sort object keys so key order never changes the hash. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * HMAC-SHA256 over the canonical JSON of the payload, hex encoded.
 * The `checksum` and `checksumMethod` fields are always excluded.
 */
export function computeChecksum(payload, key = env.clickpesa.checksumKey) {
  if (!key) return null;
  const { checksum, checksumMethod, ...rest } = payload || {};
  const canonical = JSON.stringify(canonicalize(rest));
  return crypto.createHmac('sha256', key).update(canonical).digest('hex');
}

/**
 * Verify a checksum in constant time. A length mismatch is rejected before
 * timingSafeEqual, which throws on unequal buffer lengths.
 */
export function verifyChecksum(payload, provided, key = env.clickpesa.checksumKey) {
  if (!key || !provided) return false;
  const expected = computeChecksum(payload, key);
  if (!expected) return false;
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(provided), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* phone formatting                                                    */
/* ------------------------------------------------------------------ */

/** ClickPesa wants 255XXXXXXXXX: country code, no plus, no spaces. */
export function toGatewayPhone(e164OrLocal) {
  const digits = String(e164OrLocal || '').replace(/[^\d]/g, '');
  if (/^255[67]\d{8}$/.test(digits)) return digits;
  if (/^0[67]\d{8}$/.test(digits)) return `255${digits.slice(1)}`;
  if (/^[67]\d{8}$/.test(digits)) return `255${digits}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* token cache                                                         */
/* ------------------------------------------------------------------ */

// The token lasts an hour; it is cached in-process and refreshed a little
// early. Concurrent callers share one in-flight refresh.
let tokenCache = { value: null, expiresAt: 0 };
let tokenPromise = null;

async function fetchToken() {
  const res = await timedFetch(`${BASE}/generate-token`, {
    method: 'POST',
    headers: {
      'client-id': env.clickpesa.clientId,
      'api-key': env.clickpesa.apiKey,
      'Content-Type': 'application/json',
    },
  });

  const body = await safeJson(res);
  if (!res.ok || !body?.token) {
    throw new GatewayError(
      body?.message || 'Could not authenticate with the payment gateway',
      { status: res.status, body, retryable: res.status >= 500 },
    );
  }
  // The provider returns the token already prefixed with "Bearer ".
  return String(body.token);
}

export async function getToken({ force = false } = {}) {
  if (!env.clickpesa.configured) {
    throw new GatewayError('The payment gateway is not configured', { code: 'not_configured' });
  }
  if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  if (!tokenPromise) {
    tokenPromise = fetchToken()
      .then((token) => {
        // Refresh five minutes before the hour is up.
        tokenCache = { value: token, expiresAt: Date.now() + 55 * 60_000 };
        return token;
      })
      .finally(() => {
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

export function clearTokenCache() {
  tokenCache = { value: null, expiresAt: 0 };
}

/* ------------------------------------------------------------------ */
/* transport                                                           */
/* ------------------------------------------------------------------ */

async function timedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GatewayError('The payment gateway did not respond in time', {
        code: 'timeout',
        retryable: true,
      });
    }
    throw new GatewayError('Could not reach the payment gateway', {
      code: 'network',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

const safeJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/** Never log the values that would let someone move money. */
const SECRET_KEYS = new Set(['api-key', 'apikey', 'authorization', 'client-id', 'token', 'checksum']);
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

async function logCall({ operation, endpoint, method, status, orderReference, request, response, error, ms }) {
  try {
    await execute(
      `INSERT INTO gateway_requests
         (provider, operation, endpoint, method, status_code, order_reference,
          request_body, response_body, error_message, duration_ms)
       VALUES ('clickpesa', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operation,
        endpoint,
        method,
        status ?? null,
        orderReference ?? null,
        request ? JSON.stringify(scrub(request)) : null,
        response ? JSON.stringify(response).slice(0, 60_000) : null,
        error ? String(error).slice(0, 500) : null,
        ms ?? null,
      ],
    );
  } catch (err) {
    console.error('[pazo:clickpesa] call log failed:', err.message);
  }
}

/**
 * One authenticated request. A 401 refreshes the token once and retries,
 * which covers a token revoked before its stated expiry.
 */
async function call(operation, path, { method = 'POST', body = null, retryAuth = true } = {}) {
  const started = Date.now();
  const token = await getToken();

  const payload = body ? { ...body } : null;
  if (payload && env.clickpesa.checksumKey) {
    payload.checksum = computeChecksum(payload);
  }

  let res;
  let json = null;
  try {
    res = await timedFetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    json = await safeJson(res);
  } catch (err) {
    await logCall({
      operation,
      endpoint: path,
      method,
      orderReference: body?.orderReference,
      request: payload,
      error: err.message,
      ms: Date.now() - started,
    });
    throw err;
  }

  await logCall({
    operation,
    endpoint: path,
    method,
    status: res.status,
    orderReference: body?.orderReference,
    request: payload,
    response: json,
    error: res.ok ? null : json?.message,
    ms: Date.now() - started,
  });

  if (res.status === 401 && retryAuth) {
    clearTokenCache();
    return call(operation, path, { method, body, retryAuth: false });
  }

  if (!res.ok) {
    const message = json?.message || json?.error || `Gateway returned ${res.status}`;
    throw new GatewayError(message, {
      status: res.status,
      body: json,
      code: gatewayCode(res.status, message),
      // 5xx and 429 are worth retrying; 4xx means the request itself is wrong.
      retryable: res.status >= 500 || res.status === 429,
    });
  }

  return json;
}

function gatewayCode(status, message) {
  const text = String(message || '').toLowerCase();
  if (status === 409) return 'duplicate_reference';
  if (text.includes('insufficient')) return 'insufficient_balance';
  if (text.includes('rate') || status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 400) return 'validation';
  return null;
}

/* ------------------------------------------------------------------ */
/* collections — a business funds its wallet                           */
/* ------------------------------------------------------------------ */

/**
 * Push a payment prompt to the payer's phone. They approve it on the handset;
 * the wallet is credited only when the webhook confirms.
 */
export async function initiateCollection({ amountTzs, phoneNumber, orderReference }) {
  const phone = toGatewayPhone(phoneNumber);
  if (!phone) throw new GatewayError('That mobile money number is not valid', { code: 'validation' });

  return call('collection.initiate', '/payments/initiate-ussd-push-request', {
    body: {
      amount: String(amountTzs),
      currency: 'TZS',
      orderReference,
      phoneNumber: phone,
    },
  });
}

export async function getCollectionStatus(orderReference) {
  return call('collection.status', `/payments/${encodeURIComponent(orderReference)}`, {
    method: 'GET',
  });
}

/* ------------------------------------------------------------------ */
/* payouts — paying an agent                                           */
/* ------------------------------------------------------------------ */

/**
 * Preview returns the fee and, usefully, the account name held by the mobile
 * operator. That name is shown to the partner before they confirm, so money
 * never leaves on a mistyped number.
 */
export async function previewPayout({ amountTzs, phoneNumber, orderReference }) {
  const phone = toGatewayPhone(phoneNumber);
  if (!phone) throw new GatewayError('That mobile money number is not valid', { code: 'validation' });

  return call('payout.preview', '/payouts/preview-mobile-money-payout', {
    body: { amount: amountTzs, currency: 'TZS', orderReference, phoneNumber: phone },
  });
}

/** Create the payout. Rate limited by the provider to one per 60 seconds. */
export async function createPayout({ amountTzs, phoneNumber, orderReference }) {
  const phone = toGatewayPhone(phoneNumber);
  if (!phone) throw new GatewayError('That mobile money number is not valid', { code: 'validation' });

  return call('payout.create', '/payouts/create-mobile-money-payout', {
    body: { amount: amountTzs, currency: 'TZS', orderReference, phoneNumber: phone },
  });
}

export async function getPayoutStatus(orderReference) {
  const result = await call('payout.status', `/payouts/${encodeURIComponent(orderReference)}`, {
    method: 'GET',
  });
  // This endpoint returns an array; the newest entry is the current state.
  if (Array.isArray(result)) return result[result.length - 1] || null;
  return result;
}

export async function getBalance() {
  return call('account.balance', '/accounts/balance', { method: 'GET' });
}

/* ------------------------------------------------------------------ */
/* status mapping                                                      */
/* ------------------------------------------------------------------ */

/**
 * Collapse the provider's vocabulary into the three outcomes the platform
 * cares about. Anything unrecognised stays pending rather than being guessed
 * as success, so money is never released on an unknown status.
 */
export function mapPayoutStatus(providerStatus) {
  switch (String(providerStatus || '').toUpperCase()) {
    case 'SUCCESS':
    case 'SETTLED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'REFUNDED':
    case 'REVERSED':
      return 'reversed';
    case 'AUTHORIZED':
    case 'PROCESSING':
    case 'PENDING':
      return 'processing';
    default:
      return 'processing';
  }
}

export function mapCollectionStatus(providerStatus) {
  switch (String(providerStatus || '').toUpperCase()) {
    case 'SUCCESS':
    case 'SETTLED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'PROCESSING':
    case 'PENDING':
      return 'processing';
    default:
      return 'processing';
  }
}

export const isConfigured = () => env.clickpesa.configured;
