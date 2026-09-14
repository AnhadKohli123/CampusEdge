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
  // Where the frontend lives -- invite links are built against this.
  appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),

  // The largest a group may be. A group is matched to a room whose capacity
  // equals its *actual* member count, so a pair gets a 2-seater and a single
  // student gets a single room -- this is only the upper bound.
  maxGroupSize: Number(process.env.MAX_GROUP_SIZE ?? process.env.GROUP_SIZE ?? 4),
  currentSemester: process.env.CURRENT_SEMESTER ?? '2024-Spring',
};
