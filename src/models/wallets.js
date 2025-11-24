// src/models/wallets.js
'use strict';

const { pool } = require('../config/database');

exports.createWalletsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,

      network TEXT NOT NULL,
      token TEXT NOT NULL,
      address TEXT NOT NULL,
      priv_enc TEXT,

      sweep_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
};
