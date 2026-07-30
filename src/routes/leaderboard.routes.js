'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/leaderboard
 *
 * Current ranking:
 * 1. Highest account balance
 * 2. Fallback to newest users
 */

router.get('/', auth, async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT
        u.email,
        COALESCE(a.balance_cents, 0) AS referral_earnings_cents
      FROM users u
      LEFT JOIN accounts a
        ON a.user_id = u.id
      ORDER BY
        referral_earnings_cents DESC,
        u.created_at DESC
      LIMIT 10
    `);

    const hasAnyBalance = rows.some(
      r => Number(r.referral_earnings_cents) > 0
    );

    if (!hasAnyBalance) {

      const { rows: fallback } = await pool.query(`
        SELECT
          email,
          0 AS referral_earnings_cents
        FROM users
        ORDER BY created_at DESC
        LIMIT 10
      `);

      return res.json(fallback);
    }

    return res.json(rows);

  } catch (err) {

    console.error('Leaderboard error:', err);

    return res.status(500).json({
      error: 'Leaderboard failed'
    });

  }
});

module.exports = router;