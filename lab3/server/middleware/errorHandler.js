const mongoose = require('mongoose');
const multer = require('multer');
const { validationResult } = require('express-validator');
const { HttpError, notFound, unprocessable } = require('../errors');

const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(unprocessable(errors.array().map((e) => e.msg)));
  }
  return next();
};

const notFoundHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

const toHttpError = (err) => {
  if (err instanceof HttpError) return err;

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new HttpError(413, 'File is too large. Max size is 5 MB');
    }
    return new HttpError(400, err.message);
  }

  if (err.type === 'entity.parse.failed') {
    return new HttpError(400, 'Malformed JSON body');
  }

  if (err.type === 'entity.too.large') {
    return new HttpError(413, 'Request body is too large');
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return new HttpError(422, 'Validation failed', {
      details: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return new HttpError(400, `Invalid value for ${err.path}`);
  }

  if (err.code === 11000) {
    return new HttpError(409, 'Resource already exists');
  }

  return new HttpError(500, 'Internal server error');
};

const errorHandler = (err, req, res, _next) => {
  const httpError = toHttpError(err);

  if (httpError.status >= 500) {
    req.log.error({ err }, 'Unhandled error');
  } else {
    req.log.warn({ status: httpError.status, reason: httpError.message }, 'Request rejected');
  }

  if (httpError.headers) {
    res.set(httpError.headers);
  }

  const body = { error: httpError.message, status: httpError.status };
  if (httpError.details) body.details = httpError.details;
  if (req.id) body.requestId = req.id;

  res.status(httpError.status).json(body);
};

module.exports = { validate, notFoundHandler, errorHandler };
