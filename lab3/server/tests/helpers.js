process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.MAX_LOGIN_ATTEMPTS = '3';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.MAX_SESSIONS = '2';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../app');
const { User } = require('../models/User');

const baseUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

const connect = async (dbName) => {
  const uri = `${baseUri.replace(/\/[^/]*$/, '')}/${dbName}`;
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
};

const disconnect = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

const createUser = async ({ email, password = 'secret123', role = 'user', name = 'Test User' }) =>
  User.create({ email, name, role, passwordHash: await bcrypt.hash(password, 4) });

const login = async (email, password = 'secret123') => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  return { agent, token: res.body.accessToken, res };
};

module.exports = { app, request, connect, disconnect, createUser, login };
