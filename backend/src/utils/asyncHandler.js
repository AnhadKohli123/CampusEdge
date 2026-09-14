/**
 * Express 4 does not forward rejected promises to the error middleware.
 * Wrapping every async route keeps the routes free of try/catch noise.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
