// src/routes/leaderboard.routes.js
'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    // First: check if anyone has referral earnings
    const earningsRes = await pool.query(`
      SELECT email, referral_earnings_cents
      FROM users
      WHERE referral_earnings_cents > 0
      ORDER BY referral_earnings_cents DESC
      LIMIT 10
    `);

    if (earningsRes.rowCount > 0) {
      return res.json(earningsRes.rows);
    }

    // Fallback: latest 10 signups
    const signupRes = await pool.query(`
      SELECT email, 0 AS referral_earnings_cents
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    return res.json(signupRes.rows);

  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Leaderboard failed' });
  }
});

module.exports = router;


