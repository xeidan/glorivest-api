'use strict';

const { pool } = require('../config/database');

const DEMO_BALANCE_CENTS = 1_000_000;

// -----------------------------
// GET ALL WALLETS (FOR DASHBOARD)
// -----------------------------
// src/controllers/wallet.controller.js
exports.getWallets = async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      code,
      type,
      balance_cents,
      status
    FROM wallets
    WHERE user_id=$1
    ORDER BY id ASC
    `,
    [req.user.id]
  );

  res.json(rows);
};



module.exports = {
  getWallets
};
