const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param } = require('express-validator');
const config = require('../config');
const mailer = require('../services/mailer');
const { User } = require('../models/User');
const { Session } = require('../models/Session');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/errorHandler');
const {
  REFRESH_COOKIE,
  hashToken,
  randomToken,
  signAccessToken,
  createSession,
  rotateSession,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../services/tokens');
const {
  asyncHandler,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  badRequest,
  tooManyRequests,
  methodNotAllowed,
} = require('../errors');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

const emailRule = body('email')
  .trim()
  .notEmpty()
  .withMessage('Email is required')
  .isEmail()
  .withMessage('Email is invalid')
  .normalizeEmail({ gmail_remove_dots: false });

const passwordRule = (field) =>
  body(field)
    .isString()
    .withMessage('Password is required')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/[A-Za-zА-Яа-я]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a digit');

const secondsUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));

const issueTokens = async (user, req, res) => {
  const { session, refreshToken, evicted } = await createSession(user, req);
  if (evicted > 0) {
    req.log.info({ event: 'session.evicted', userId: String(user._id), count: evicted }, 'Old sessions closed');
  }
  setRefreshCookie(res, refreshToken);
  return { user: user.toPublic(), accessToken: signAccessToken(user, session) };
};

router
  .route('/register')
  .post(
    authLimiter,
    emailRule,
    body('name')
      .trim()
      .isLength({ min: 2, max: 60 })
      .withMessage('Name must be between 2 and 60 characters'),
    passwordRule('password'),
    validate,
    asyncHandler(async (req, res) => {
      const { email, name, password } = req.body;

      if (await User.exists({ email })) {
        throw conflict('User with this email already exists');
      }

      const user = await User.create({
        email,
        name,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      });

      req.log.info({ event: 'auth.register', userId: String(user._id) }, 'User registered');
      res.status(201).json(await issueTokens(user, req, res));
    })
  )
  .all(methodNotAllowed(['POST']));

router
  .route('/login')
  .post(
    authLimiter,
    emailRule,
    body('password').isString().notEmpty().withMessage('Password is required'),
    validate,
    asyncHandler(async (req, res) => {
      const { email, password } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        await bcrypt.compare(password, DUMMY_HASH);
        req.log.warn({ event: 'auth.login_failed', email, reason: 'unknown_user' }, 'Login failed');
        throw unauthorized('Invalid email or password');
      }

      if (user.isLocked()) {
        req.log.warn({ event: 'auth.login_locked', userId: String(user._id) }, 'Login to locked account');
        throw tooManyRequests('Account is temporarily locked', secondsUntil(user.lockUntil));
      }

      const ok = await bcrypt.compare(password, user.passwordHash);

      if (!ok) {
        user.failedLoginAttempts += 1;
        const attempts = user.failedLoginAttempts;

        if (attempts >= config.maxLoginAttempts) {
          user.lockUntil = new Date(Date.now() + config.lockMinutes * 60 * 1000);
          user.failedLoginAttempts = 0;
          await user.save();
          req.log.warn({ event: 'auth.account_locked', userId: String(user._id) }, 'Account locked');
          throw tooManyRequests(
            `Too many failed attempts. Account locked for ${config.lockMinutes} minutes`,
            secondsUntil(user.lockUntil)
          );
        }

        await user.save();
        req.log.warn(
          { event: 'auth.login_failed', userId: String(user._id), attempts },
          'Login failed'
        );
        throw unauthorized('Invalid email or password');
      }

      if (!user.isActive) {
        throw forbidden('Account is disabled');
      }

      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      req.log.info({ event: 'auth.login', userId: String(user._id) }, 'User logged in');
      res.status(200).json(await issueTokens(user, req, res));
    })
  )
  .all(methodNotAllowed(['POST']));

router
  .route('/refresh')
  .post(
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token) throw unauthorized('Refresh token is missing');

      const session = await Session.findOne({ refreshTokenHash: hashToken(token) });
      if (!session || !session.isActive()) {
        clearRefreshCookie(res);
        throw unauthorized('Session expired, please log in again');
      }

      const user = await User.findById(session.user);
      if (!user || !user.isActive) {
        session.revokedAt = new Date();
        await session.save();
        clearRefreshCookie(res);
        throw unauthorized('Account is disabled');
      }

      const refreshToken = await rotateSession(session);
      setRefreshCookie(res, refreshToken);
      res.status(200).json({ user: user.toPublic(), accessToken: signAccessToken(user, session) });
    })
  )
  .all(methodNotAllowed(['POST']));

router
  .route('/logout')
  .post(
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (token) {
        await Session.updateOne(
          { refreshTokenHash: hashToken(token), revokedAt: null },
          { revokedAt: new Date() }
        );
      }
      clearRefreshCookie(res);
      res.status(204).end();
    })
  )
  .all(methodNotAllowed(['POST']));

router
  .route('/me')
  .get(authenticate, (req, res) => {
    res.status(200).json(req.user.toPublic());
  })
  .all(methodNotAllowed(['GET']));

router
  .route('/sessions')
  .get(
    authenticate,
    asyncHandler(async (req, res) => {
      const sessions = await Session.find({
        user: req.user._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ lastUsedAt: -1 });

      res.status(200).json(
        sessions.map((s) => ({
          _id: s._id,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          current: String(s._id) === String(req.session._id),
        }))
      );
    })
  )
  .delete(
    authenticate,
    asyncHandler(async (req, res) => {
      const result = await Session.updateMany(
        { user: req.user._id, _id: { $ne: req.session._id }, revokedAt: null },
        { revokedAt: new Date() }
      );
      req.log.info({ event: 'session.revoke_others', count: result.modifiedCount }, 'Other sessions closed');
      res.status(204).end();
    })
  )
  .all(methodNotAllowed(['GET', 'DELETE']));

router
  .route('/sessions/:id')
  .delete(
    authenticate,
    param('id').isMongoId().withMessage('Invalid session id'),
    validate,
    asyncHandler(async (req, res) => {
      const session = await Session.findOne({
        _id: req.params.id,
        user: req.user._id,
        revokedAt: null,
      });
      if (!session) throw notFound('Session not found');

      session.revokedAt = new Date();
      await session.save();

      req.log.info({ event: 'session.revoke', sessionId: String(session._id) }, 'Session closed');
      res.status(204).end();
    })
  )
  .all(methodNotAllowed(['DELETE']));

router
  .route('/forgot-password')
  .post(
    authLimiter,
    emailRule,
    validate,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ email: req.body.email });

      if (user && user.isActive) {
        const token = randomToken();
        user.resetPasswordHash = hashToken(token);
        user.resetPasswordExpires = new Date(Date.now() + config.resetTokenMinutes * 60 * 1000);
        await user.save();

        try {
          await mailer.sendPasswordReset(user, token);
        } catch (err) {
          req.log.error({ err, event: 'mail.failed' }, 'Failed to send reset email');
        }
        req.log.info({ event: 'auth.reset_requested', userId: String(user._id) }, 'Password reset requested');
      }

      // одинаковый ответ, чтобы нельзя было проверить наличие email
      res.status(202).json({ message: 'If the account exists, a reset link has been sent' });
    })
  )
  .all(methodNotAllowed(['POST']));

router
  .route('/reset-password')
  .post(
    authLimiter,
    body('token').isString().isLength({ min: 20 }).withMessage('Reset token is required'),
    passwordRule('password'),
    validate,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({
        resetPasswordHash: hashToken(req.body.token),
        resetPasswordExpires: { $gt: new Date() },
      });
      if (!user) throw badRequest('Reset link is invalid or expired');

      user.passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      user.resetPasswordHash = null;
      user.resetPasswordExpires = null;
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });

      req.log.info({ event: 'auth.password_reset', userId: String(user._id) }, 'Password changed');
      res.status(200).json({ message: 'Password has been changed' });
    })
  )
  .all(methodNotAllowed(['POST']));

module.exports = router;
