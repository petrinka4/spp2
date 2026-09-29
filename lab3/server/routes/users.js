const express = require('express');
const { body, param } = require('express-validator');
const { User, ROLES } = require('../models/User');
const { Session } = require('../models/Session');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const { asyncHandler, notFound, conflict, methodNotAllowed } = require('../errors');

const router = express.Router();

router.use(authenticate, authorize('admin'));

const idRule = param('id').isMongoId().withMessage('Invalid user id');

router
  .route('/')
  .get(
    asyncHandler(async (_req, res) => {
      const users = await User.find().sort({ createdAt: 1 });
      const counts = await Session.aggregate([
        { $match: { revokedAt: null, expiresAt: { $gt: new Date() } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ]);
      const byUser = new Map(counts.map((c) => [String(c._id), c.count]));

      res.status(200).json(
        users.map((u) => ({ ...u.toPublic(), activeSessions: byUser.get(String(u._id)) || 0 }))
      );
    })
  )
  .all(methodNotAllowed(['GET']));

router
  .route('/:id')
  .patch(
    idRule,
    body('role')
      .optional()
      .isIn(ROLES)
      .withMessage(`Role must be one of: ${ROLES.join(', ')}`),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean').toBoolean(),
    validate,
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.params.id);
      if (!user) throw notFound('User not found');

      const isSelf = String(user._id) === String(req.user._id);
      if (isSelf && ((req.body.role && req.body.role !== 'admin') || req.body.isActive === false)) {
        throw conflict('You cannot demote or disable your own account');
      }

      if (req.body.role) user.role = req.body.role;
      if (typeof req.body.isActive === 'boolean') user.isActive = req.body.isActive;
      await user.save();

      if (!user.isActive) {
        await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
      }

      req.log.info(
        { event: 'user.updated', targetId: String(user._id), newRole: user.role, isActive: user.isActive },
        'User updated by admin'
      );
      res.status(200).json(user.toPublic());
    })
  )
  .all(methodNotAllowed(['PATCH']));

router
  .route('/:id/sessions')
  .delete(
    idRule,
    validate,
    asyncHandler(async (req, res) => {
      if (!(await User.exists({ _id: req.params.id }))) throw notFound('User not found');

      const result = await Session.updateMany(
        { user: req.params.id, revokedAt: null },
        { revokedAt: new Date() }
      );
      req.log.info(
        { event: 'session.revoke_user', targetId: req.params.id, count: result.modifiedCount },
        'User sessions closed by admin'
      );
      res.status(204).end();
    })
  )
  .all(methodNotAllowed(['DELETE']));

module.exports = router;
