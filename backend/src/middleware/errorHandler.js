import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

// Postgres error codes we can translate into something a client can act on.
const PG_CODES = {
  '23505': (err) => ({
    status: 409,
    message: `Conflict: ${err.constraint ?? 'a unique constraint'} already exists`,
  }),
  '23503': () => ({ status: 400, message: 'Referenced record does not exist' }),
  '23514': (err) => ({
    status: 400,
    message: `Value violates constraint ${err.constraint ?? ''}`.trim(),
  }),
  '40001': () => ({
    status: 503,
    message: 'Serialization failure, please retry',
  }),
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg shape
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }

  const translate = PG_CODES[err.code];
  if (translate) {
    const { status, message } = translate(err);
    return res.status(status).json({ error: message });
  }

  console.error('[error]', err);
  res.status(500).json({
    error: 'Internal server error',
    ...(config.env === 'development' ? { detail: err.message } : {}),
  });
}
