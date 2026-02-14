'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    // 1️⃣ Try earnings leaderboard
    const earningsRes = await pool.query(`
      SELECT email,
             COALESCE(referral_earnings_cents, 0) AS referral_earnings_cents
      FROM users
      ORDER BY referral_earnings_cents DESC NULLS LAST
      LIMIT 10
    `);

    if (earningsRes.rowCount > 0) {
      return res.json(earningsRes.rows);
    }

    // 2️⃣ Fallback: simple latest users (NO created_at dependency)
    const fallback = await pool.query(`
      SELECT email, 0 AS referral_earnings_cents
      FROM users
      LIMIT 10
    `);

    return res.json(fallback.rows);

  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Leaderboard failed' });
  }
});

module.exports = router;
