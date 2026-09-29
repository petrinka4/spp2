const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async (retries = 20) => {
  const uri = config.mongoUri;

  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri);
      logger.info('MongoDB connected');
      return;
    } catch (err) {
      logger.error({ attempt, retries, err: err.message }, 'MongoDB connect failed');
      if (attempt === retries) {
        throw err;
      }
      await sleep(2000);
    }
  }
};

module.exports = connectDB;
