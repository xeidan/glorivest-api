// src/models/users.js
'use strict';

const { pool } = require('../config/database');

exports.createUserTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',

      balance NUMERIC DEFAULT 0,

      tron_wallet TEXT,
      tron_private_encrypted TEXT,

      bot_active BOOLEAN DEFAULT false,
      bot_started_at TIMESTAMP,
      bot_ended_at TIMESTAMP,
      eligible_for_withdrawal BOOLEAN DEFAULT false,

      total_earnings NUMERIC DEFAULT 0,
      last_login TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
};
