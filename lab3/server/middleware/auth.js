const { User } = require('../models/User');
const { Session } = require('../models/Session');
const { verifyAccessToken } = require('../services/tokens');
const { unauthorized, forbidden, asyncHandler } = require('../errors');

const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw unauthorized();
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
  }

  const [user, session] = await Promise.all([
    User.findById(payload.sub),
    Session.findById(payload.sid),
  ]);

  if (!session || !session.isActive() || String(session.user) !== String(payload.sub)) {
    throw unauthorized('Session is no longer active');
  }
  if (!user || !user.isActive) {
    throw unauthorized('Account is disabled');
  }

  req.user = user;
  req.session = session;
  req.log = req.log.child({ userId: String(user._id), role: user.role });
  next();
});

const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Insufficient permissions'));
    }
    return next();
  };

module.exports = { authenticate, authorize };
