const rateLimit = require('express-rate-limit');
const config = require('../config');
const { tooManyRequests } = require('../errors');

const WINDOW_MS = 15 * 60 * 1000;

const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.authRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, _res, next) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(WINDOW_MS / 1000);

    req.log.warn({ event: 'auth.rate_limited', ip: req.ip }, 'Too many auth requests');
    next(tooManyRequests('Too many requests, try again later', retryAfter));
  },
});

module.exports = { authLimiter };
