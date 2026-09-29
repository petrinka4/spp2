const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  base: { service: 'spp-lab3-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
    ],
    censor: '[hidden]',
  },
});

module.exports = logger;
