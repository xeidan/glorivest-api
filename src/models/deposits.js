// src/models/deposits.js
'use strict';

const { pool } = require('../config/database');

exports.createDepositsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id),

      network TEXT NOT NULL,
      token TEXT NOT NULL,

      tx_hash TEXT UNIQUE,
      amount NUMERIC,
      status TEXT DEFAULT 'pending',

      swept BOOLEAN DEFAULT false,

      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
};
