const mongoose = require('mongoose');

const ROLES = ['user', 'manager', 'admin'];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'user' },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    resetPasswordHash: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil > new Date());
};

userSchema.methods.toPublic = function toPublic() {
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    role: this.role,
    isActive: this.isActive,
    createdAt: this.createdAt,
  };
};

module.exports = {
  User: mongoose.model('User', userSchema),
  ROLES,
};
