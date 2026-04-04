'use strict';

const { pool } = require('../config/database');

exports.createSettingsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
};

/* =========================
   GET
========================= */
exports.get = async (key) => {
  const { rows } = await pool.query(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [key]
  );
  return rows[0]?.value || null;
};

/* =========================
   SET
========================= */
exports.set = async (key, value) => {
  await pool.query(
    `
    INSERT INTO settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value
    `,
    [key, value]
  );
};