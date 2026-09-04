#!/usr/bin/env node
/**
 * Applies db/schema.sql. Pass --drop to tear the schema down first.
 *   npm run migrate
 *   node scripts/migrate.js --drop
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, '..', 'db');

async function run() {
  const shouldDrop = process.argv.includes('--drop');

  if (shouldDrop) {
    console.log('[migrate] dropping existing tables');
    await pool.query(await readFile(join(dbDir, 'drop.sql'), 'utf8'));
  }

  console.log('[migrate] applying schema.sql');
  await pool.query(await readFile(join(dbDir, 'schema.sql'), 'utf8'));
  console.log('[migrate] done');
}

run()
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
