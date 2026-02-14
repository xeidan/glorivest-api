'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/leaderboard
 *
 * Ranking priority:
 * 1. Users ranked by REFERRAL wallet balance (DESC)
 * 2. If all balances are 0 → fallback to newest signups
 */
router.get('/', auth, async (req, res) => {
  try {

    // Get top 10 ranked by referral wallet balance
    const { rows } = await pool.query(
      `
      SELECT 
        u.email,
        COALESCE(w.balance_cents, 0) AS referral_earnings_cents
      FROM users u
      LEFT JOIN wallets w
        ON w.user_id = u.id
       AND w.type = 'REFERRAL'
      ORDER BY referral_earnings_cents DESC
      LIMIT 10
      `
    );

    const hasAnyEarnings = rows.some(
      r => Number(r.referral_earnings_cents) > 0
    );

    // Fallback if nobody has earnings
    if (!hasAnyEarnings) {
      const fallback = await pool.query(
        `
        SELECT 
          email,
          0 AS referral_earnings_cents
        FROM users
        ORDER BY created_at DESC
        LIMIT 10
        `
      );

      return res.json(fallback.rows);
    }

    return res.json(rows);

  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Leaderboard failed' });
  }
});

module.exports = router;
