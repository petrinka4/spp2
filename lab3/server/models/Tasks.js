const mongoose = require('mongoose');

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [2, 'Title must be at least 2 characters'],
      maxlength: [120, 'Title must be at most 120 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description must be at most 2000 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: 'Status must be one of: todo, in_progress, done',
      },
      default: 'todo',
    },
    priority: {
      type: String,
      enum: {
        values: PRIORITIES,
        message: 'Priority must be one of: low, medium, high',
      },
      default: 'medium',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    attachment: {
      originalName: { type: String, default: null },
      storedName: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

module.exports = {
  Task: mongoose.model('Task', taskSchema),
  STATUSES,
  PRIORITIES,
};
