const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { body, param } = require('express-validator');
const { Task, STATUSES, PRIORITIES } = require('../models/Tasks');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const {
  HttpError,
  asyncHandler,
  forbidden,
  notFound,
  methodNotAllowed,
} = require('../errors');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new HttpError(415, 'Unsupported file type. Allowed: images, PDF, TXT, DOC, DOCX'));
    }
    return cb(null, true);
  },
});

const handleUpload = upload.single('attachment');

const taskValidators = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 2, max: 120 })
    .withMessage('Title must be between 2 and 120 characters'),
  body('description')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be at most 2000 characters'),
  body('status')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}`),
  body('priority')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(PRIORITIES)
    .withMessage(`Priority must be one of: ${PRIORITIES.join(', ')}`),
  body('dueDate')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('dueDate must be a valid date (ISO 8601)'),
];

const idValidator = [param('id').isMongoId().withMessage('Invalid task id'), validate];

const canSeeAll = (user) => user.role === 'manager' || user.role === 'admin';

const isOwner = (user, task) => String(task.owner?._id ?? task.owner) === String(user._id);

const canEdit = (user, task) => canSeeAll(user) || isOwner(user, task);

const canDelete = (user, task) => user.role === 'admin' || isOwner(user, task);

const removeFile = (storedName) => {
  if (!storedName) return;
  const filePath = path.join(uploadsDir, storedName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// если запрос упал, загруженный файл не нужен
const cleanupOnError = (err, req, _res, next) => {
  if (req.file) removeFile(req.file.filename);
  next(err);
};

const buildPayload = (bodyData, file, existing) => {
  const payload = {
    title: bodyData.title,
    description: bodyData.description ?? existing?.description ?? '',
    status: bodyData.status || existing?.status || 'todo',
    priority: bodyData.priority || existing?.priority || 'medium',
    dueDate: bodyData.dueDate ? new Date(bodyData.dueDate) : existing?.dueDate ?? null,
  };

  if (file) {
    payload.attachment = {
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  return payload;
};

const loadTask = async (req) => {
  const task = await Task.findById(req.params.id).populate('owner', 'name email');
  if (!task) throw notFound('Task not found');
  if (!canSeeAll(req.user) && !isOwner(req.user, task)) {
    throw forbidden('You do not have access to this task');
  }
  return task;
};

router.use(authenticate);

router
  .route('/')
  .get(
    asyncHandler(async (req, res) => {
      const filter = canSeeAll(req.user) ? {} : { owner: req.user._id };
      const tasks = await Task.find(filter).sort({ createdAt: -1 }).populate('owner', 'name email');
      res.status(200).json(tasks);
    })
  )
  .post(
    handleUpload,
    taskValidators,
    validate,
    asyncHandler(async (req, res) => {
      const task = await Task.create({ ...buildPayload(req.body, req.file), owner: req.user._id });
      await task.populate('owner', 'name email');

      req.log.info({ event: 'task.created', taskId: String(task._id) }, 'Task created');
      res.status(201).location(`${req.baseUrl}/${task._id}`).json(task);
    }),
    cleanupOnError
  )
  .all(methodNotAllowed(['GET', 'POST']));

router
  .route('/:id')
  .get(
    idValidator,
    asyncHandler(async (req, res) => {
      res.status(200).json(await loadTask(req));
    })
  )
  .put(
    handleUpload,
    idValidator,
    taskValidators,
    validate,
    asyncHandler(async (req, res) => {
      const existing = await loadTask(req);
      if (!canEdit(req.user, existing)) throw forbidden('You cannot edit this task');

      const payload = buildPayload(req.body, req.file, existing);
      const oldFile = existing.attachment?.storedName;

      Object.assign(existing, payload);
      await existing.save();

      if (req.file && oldFile) {
        removeFile(oldFile);
      }

      req.log.info({ event: 'task.updated', taskId: String(existing._id) }, 'Task updated');
      res.status(200).json(existing);
    }),
    cleanupOnError
  )
  .delete(
    idValidator,
    asyncHandler(async (req, res) => {
      const task = await loadTask(req);
      if (!canDelete(req.user, task)) throw forbidden('Only the owner or admin can delete this task');

      await task.deleteOne();
      removeFile(task.attachment?.storedName);

      req.log.info({ event: 'task.deleted', taskId: String(task._id) }, 'Task deleted');
      res.status(204).end();
    })
  )
  .all(methodNotAllowed(['GET', 'PUT', 'DELETE']));

router
  .route('/:id/attachment')
  .get(
    idValidator,
    asyncHandler(async (req, res) => {
      const task = await loadTask(req);
      const storedName = task.attachment?.storedName;
      if (!storedName || !fs.existsSync(path.join(uploadsDir, storedName))) {
        throw notFound('Attachment not found');
      }

      res.type(task.attachment.mimeType || 'application/octet-stream');
      res.sendFile(path.join(uploadsDir, storedName), {
        headers: {
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(task.attachment.originalName)}`,
        },
      });
    })
  )
  .all(methodNotAllowed(['GET']));

module.exports = router;
