/**
 * Response envelope used by every endpoint, per spec 6.1:
 *   { success: bool, data: {}, error: string }
 */

export class ApiError extends Error {
  constructor(status, message, code = null, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg = 'Invalid request', details = null) =>
  new ApiError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Not authenticated') =>
  new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to this resource') =>
  new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new ApiError(404, msg, 'not_found');
export const conflict = (msg = 'Conflict') => new ApiError(409, msg, 'conflict');
export const tooMany = (msg = 'Too many requests') => new ApiError(429, msg, 'rate_limited');

export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

export function fail(res, status, error, details = null) {
  return res.status(status).json({ success: false, data: null, error, details });
}

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Parse ?page & ?limit into safe SQL values. */
export function pagination(req, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function paged(items, total, page, limit) {
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
