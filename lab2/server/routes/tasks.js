const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const { Task, STATUSES, PRIORITIES } = require('../models/Tasks');

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
      return cb(new Error('Unsupported file type. Allowed: images, PDF, TXT, DOC, DOCX'));
    }
    return cb(null, true);
  },
});

const handleUpload = (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File is too large. Max size is 5 MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    return next();
  });
};

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

const idValidator = param('id').isMongoId().withMessage('Invalid task id');

const collectErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => e.msg),
    });
    return true;
  }
  return false;
};

const removeFile = (storedName) => {
  if (!storedName) return;
  const filePath = path.join(uploadsDir, storedName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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

router.get('/', async (_req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    return res.status(200).json(tasks);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.get('/:id', idValidator, async (req, res) => {
  if (collectErrors(req, res)) return;

  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.status(200).json(task);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch task' });
  }
});

router.post('/', handleUpload, taskValidators, async (req, res) => {
  if (collectErrors(req, res)) {
    if (req.file) removeFile(req.file.filename);
    return;
  }

  try {
    const task = await Task.create(buildPayload(req.body, req.file));
    return res.status(201).json(task);
  } catch (err) {
    if (req.file) removeFile(req.file.filename);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Validation failed',
        details: Object.values(err.errors).map((e) => e.message),
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/:id', handleUpload, idValidator, taskValidators, async (req, res) => {
  if (collectErrors(req, res)) {
    if (req.file) removeFile(req.file.filename);
    return;
  }

  try {
    const existing = await Task.findById(req.params.id);
    if (!existing) {
      if (req.file) removeFile(req.file.filename);
      return res.status(404).json({ error: 'Task not found' });
    }

    const payload = buildPayload(req.body, req.file, existing);
    const oldFile = existing.attachment?.storedName;

    Object.assign(existing, payload);
    await existing.save();

    if (req.file && oldFile) {
      removeFile(oldFile);
    }

    return res.status(200).json(existing);
  } catch (err) {
    if (req.file) removeFile(req.file.filename);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Validation failed',
        details: Object.values(err.errors).map((e) => e.message),
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', idValidator, async (req, res) => {
  if (collectErrors(req, res)) return;

  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    removeFile(task.attachment?.storedName);
    return res.status(200).json({ message: 'Task deleted', id: task._id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
