const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Session } = require('../models/Session');

const REFRESH_COOKIE = 'refreshToken';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const randomToken = () => crypto.randomBytes(48).toString('hex');

const signAccessToken = (user, session) =>
  jwt.sign({ sub: String(user._id), role: user.role, sid: String(session._id) }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  });

const verifyAccessToken = (token) => jwt.verify(token, config.jwtSecret);

const refreshExpiresAt = () =>
  new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);

const createSession = async (user, req) => {
  const refreshToken = randomToken();
  const session = await Session.create({
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: (req.get('user-agent') || '').slice(0, 300),
    ip: req.ip,
    expiresAt: refreshExpiresAt(),
  });

  // старые сессии сверх лимита закрываем
  const active = await Session.find({
    user: user._id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ lastUsedAt: -1 });

  const extra = active.slice(config.maxSessions).map((s) => s._id);
  if (extra.length > 0) {
    await Session.updateMany({ _id: { $in: extra } }, { revokedAt: new Date() });
  }

  return { session, refreshToken, evicted: extra.length };
};

const rotateSession = async (session) => {
  const refreshToken = randomToken();
  session.refreshTokenHash = hashToken(refreshToken);
  session.lastUsedAt = new Date();
  session.expiresAt = refreshExpiresAt();
  await session.save();
  return refreshToken;
};

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/api/auth',
    maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
};

module.exports = {
  REFRESH_COOKIE,
  hashToken,
  randomToken,
  signAccessToken,
  verifyAccessToken,
  createSession,
  rotateSession,
  setRefreshCookie,
  clearRefreshCookie,
};
