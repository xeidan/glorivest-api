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

const { resetDemoWallet } = require('../services/wallet.service');

exports.resetDemo = async (req, res) => {
  try {
    await resetDemoWallet(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  resetDemo
};
