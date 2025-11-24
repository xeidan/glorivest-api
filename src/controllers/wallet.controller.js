// src/controllers/wallet.controller.js
'use strict';

const { pool } = require('../config/database');
const walletService = require('../services/wallet.service');

exports.createTronWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const existing = await pool.query(
      `SELECT tron_wallet, tron_private_encrypted FROM users WHERE id=$1 LIMIT 1`,
      [userId]
    );

    if (existing.rows[0].tron_wallet)
      return res.json({
        address: existing.rows[0].tron_wallet,
      });

    const newW = await walletService.generateUserWallet(userId);

    return res.json(newW);
  } catch (err) {
    console.error('createTronWallet error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT tron_wallet FROM users WHERE id=$1 LIMIT 1`,
      [userId]
    );

    return res.json({ address: q.rows[0].tron_wallet });
  } catch (err) {
    console.error('getWallet error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
