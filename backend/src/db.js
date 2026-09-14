import pg from 'pg';
import { config } from './config.js';

// DECIMAL comes back as a string by default so precision is not silently lost.
// CGPA is small and we always want to compare it numerically, so parse it.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) =>
  value === null ? null : Number(value)
);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a transaction, always releasing the client.
 * `isolation` lets the allotment job ask for SERIALIZABLE.
 */
export async function withTransaction(fn, { isolation } = {}) {
  const client = await pool.connect();
  try {
    await client.query(
      isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN'
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
