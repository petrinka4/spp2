const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./logger');
const connectDB = require('./db');
const app = require('./app');
const { User } = require('./models/User');

const ensureAdmin = async () => {
  const { email, password } = config.admin;
  if (!email || !password) return;

  const exists = await User.exists({ email: email.toLowerCase() });
  if (exists) return;

  await User.create({
    email,
    name: 'Administrator',
    role: 'admin',
    passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info({ event: 'admin.seeded', email }, 'Default admin created');
};

const start = async () => {
  try {
    await connectDB();
    await ensureAdmin();
    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Server listening');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
});

start();
