const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const config = {
  port: toInt(process.env.PORT, 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/spp_lab3',
  appUrl: process.env.APP_URL || 'http://localhost:8080',

  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: toInt(process.env.REFRESH_TOKEN_DAYS, 7),
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  maxSessions: toInt(process.env.MAX_SESSIONS, 5),
  maxLoginAttempts: toInt(process.env.MAX_LOGIN_ATTEMPTS, 5),
  lockMinutes: toInt(process.env.LOCK_MINUTES, 15),
  authRateLimit: toInt(process.env.AUTH_RATE_LIMIT, 20),
  resetTokenMinutes: toInt(process.env.RESET_TOKEN_MINUTES, 30),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 1025),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Планировщик <no-reply@spp.local>',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
