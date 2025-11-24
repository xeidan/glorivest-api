// src/models/withdrawals.js
'use strict';

const { pool } = require('../config/database');

exports.createWithdrawalsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      address TEXT NOT NULL,

      amount NUMERIC NOT NULL,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending',  -- pending/broadcasted/confirmed/failed

      created_at TIMESTAMP DEFAULT NOW(),
      broadcasted_at TIMESTAMP,
      confirmed_at TIMESTAMP
    );
  `);
};
