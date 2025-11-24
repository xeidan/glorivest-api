// src/models/accounts.js
'use strict';

const { pool } = require('../config/database');

exports.createAccountsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

      tier_code TEXT NOT NULL,
      balance_cents BIGINT DEFAULT 0,

      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_tiers (
      code TEXT PRIMARY KEY,
      display_name TEXT,
      return_percent NUMERIC,
      min_deposit_cents BIGINT,
      fee_cents BIGINT
    );
  `);
};
