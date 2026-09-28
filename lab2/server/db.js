const mongoose = require('mongoose');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async (retries = 20) => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/spp_lab2';

  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri);
      console.log('MongoDB connected');
      return;
    } catch (err) {
      console.error(`MongoDB connect failed (${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) {
        throw err;
      }
      await sleep(2000);
    }
  }
};

module.exports = connectDB;
