// src/controllers/account.controller.js
'use strict';

const pool = require('../config/database').pool;

exports.getMyAccounts = async (req, res) => {
  try {
    const { id } = req.user;

    const q = await pool.query(
      `SELECT * FROM accounts WHERE user_id=$1 ORDER BY id ASC`,
      [id]
    );

    return res.json(q.rows);
  } catch (err) {
    console.error('getMyAccounts error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getAccountById = async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT * FROM accounts WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [accountId, userId]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'Account not found' });

    return res.json(q.rows[0]);
  } catch (err) {
    console.error('getAccountById error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.createAccount = async (req, res) => {
  try {
    const { id } = req.user;
    const { tier_code } = req.body;

    const tier = await pool.query(
      `SELECT * FROM account_tiers WHERE code=$1 LIMIT 1`,
      [tier_code]
    );
    if (!tier.rows.length)
      return res.status(400).json({ message: 'Invalid tier' });

    const result = await pool.query(
      `INSERT INTO accounts (user_id, tier_code, balance_cents)
       VALUES($1, $2, 0)
       RETURNING *`,
      [id, tier_code]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('createAccount error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
