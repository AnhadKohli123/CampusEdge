import { badRequest } from '../utils/errors.js';

/**
 * Validate `req[source]` against a zod schema, replacing it with the parsed
 * value so downstream handlers get coerced, trimmed data.
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    return next(badRequest('Validation failed', details));
  }
  req[source] = result.data;
  next();
};
