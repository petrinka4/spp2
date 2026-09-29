class HttpError extends Error {
  constructor(status, message, { details, headers } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    this.headers = headers;
  }
}

const badRequest = (message = 'Bad request', details) => new HttpError(400, message, { details });

const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message, {
    headers: { 'WWW-Authenticate': 'Bearer realm="api"' },
  });

const forbidden = (message = 'Access denied') => new HttpError(403, message);

const notFound = (message = 'Resource not found') => new HttpError(404, message);

const conflict = (message) => new HttpError(409, message);

const unprocessable = (details) =>
  new HttpError(422, 'Validation failed', { details });

const tooManyRequests = (message, retryAfterSec) =>
  new HttpError(429, message, {
    headers: retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : undefined,
  });

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const methodNotAllowed = (allowed) => (_req, _res, next) => {
  next(
    new HttpError(405, 'Method not allowed', {
      headers: { Allow: allowed.join(', ') },
    })
  );
};

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  asyncHandler,
  methodNotAllowed,
};
