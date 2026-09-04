import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    'DATABASE_URL',
    'postgres://postgres:postgres@localhost:5432/campusedge'
  ),
  // Postgres on Railway/Render needs TLS; local docker does not.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  // Domain rules. Groups must be exactly this size to be allotted, and a group
  // may only take a room whose type capacity matches that size (see
  // services/allotment.service.js for why).
  groupSize: Number(process.env.GROUP_SIZE ?? 4),
  currentSemester: process.env.CURRENT_SEMESTER ?? '2024-Spring',
};
