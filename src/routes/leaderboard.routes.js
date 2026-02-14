'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/leaderboard
 * 
 * Priority:
 * 1. Users ranked by referral earnings (DESC)
 * 2. If all earnings are 0, fallback to latest signups
 */
router.get('/', auth, async (req, res) => {
  try {
    // Check if anyone actually has referral earnings > 0
    const earningsCheck = await pool.query(`
      SELECT COUNT(*) 
      FROM users 
      WHERE COALESCE(referral_earnings_cents, 0) > 0
    `);

    const hasEarnings = Number(earningsCheck.rows[0].count) > 0;

    let result;

    if (hasEarnings) {
      // Rank by earnings
      result = await pool.query(`
        SELECT email,
               COALESCE(referral_earnings_cents, 0) AS referral_earnings_cents
        FROM users
        ORDER BY referral_earnings_cents DESC
        LIMIT 10
      `);
    } else {
      // Fallback to newest signups
      result = await pool.query(`
        SELECT email,
               0 AS referral_earnings_cents
        FROM users
        ORDER BY created_at DESC
        LIMIT 10
      `);
    }

    return res.json(result.rows);

  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Leaderboard failed' });
  }
});

module.exports = router;
