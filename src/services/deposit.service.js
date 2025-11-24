// src/services/deposit.service.js
'use strict';

const { pool } = require('../config/database');
const crypto = require('crypto');
const tronPoller = require('../crypto/tron.poller');

// Create a unique deposit reference (off-chain)
exports.generateDepositReference = async (userId, amountUsd) => {
  const ref = crypto.randomBytes(6).toString('hex');

  await pool.query(
    `INSERT INTO deposits (user_id, network, token, amount, status, tx_hash)
     VALUES ($1,'reference','USD',$2,'pending',$3)`,
    [userId, amountUsd, ref]
  );

  return { reference: ref, amount_usd: amountUsd };
};

// List user's deposits
exports.getUserDeposits = async (userId) => {
  const q = await pool.query(
    `SELECT * FROM deposits 
     WHERE user_id=$1 
     ORDER BY created_at DESC`,
    [userId]
  );
  return q.rows;
};

// Run the TRON poller once
exports.pollTron = async () => {
  return tronPoller.pollTron();
};
