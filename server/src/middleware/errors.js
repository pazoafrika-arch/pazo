import env from '../config/env.js';
import { ApiError, fail } from '../utils/http.js';

export function notFoundHandler(req, res) {
  return fail(res, 404, `No endpoint matches ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return fail(res, err.status, err.message, err.details);
  }

  // MySQL duplicate-key errors map to a clean 409 rather than a 500.
  if (err && err.code === 'ER_DUP_ENTRY') {
    return fail(res, 409, 'That value is already in use');
  }
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
    return fail(res, 503, 'The database is unavailable. Please try again shortly.');
  }

  if (!env.isProd) {
    console.error('[pazo] unhandled error:', err);
  } else {
    console.error('[pazo] unhandled error:', err?.message);
  }

  return fail(
    res,
    500,
    'Something went wrong on our side. Please try again.',
    env.isProd ? null : { stack: err?.stack?.split('\n').slice(0, 4) },
  );
}
