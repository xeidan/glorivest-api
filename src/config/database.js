// src/config/database.js
// PostgreSQL Pool helper and some convenience helpers
'use strict';

const { Pool } = require('pg');
const { DATABASE_URL, NODE_ENV } = require('./env');

if (!DATABASE_URL && NODE_ENV === 'production') {
  console.error('FATAL: DATABASE_URL env is required in production');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // In many hosted Postgres (Heroku, Railway) you need SSL but with rejectUnauthorized false.
  // In strict production you should provide CA cert and set rejectUnauthorized true.
  ssl: DATABASE_URL && NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // optional: tune pool size via env (PG_MAX_POOL)
  max: Number(process.env.PG_MAX_POOL || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 2000),
});

/**
 * Convenience helper for transactional operations:
 * Usage:
 *   await withTx(async (client) => {
 *     await client.query('UPDATE ...');
 *   });
 */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  withTx,
};
