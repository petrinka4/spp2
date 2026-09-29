const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, index: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// mongo сам подчистит просроченные сессии
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.methods.isActive = function isActive() {
  return !this.revokedAt && this.expiresAt > new Date();
};

module.exports = {
  Session: mongoose.model('Session', sessionSchema),
};
