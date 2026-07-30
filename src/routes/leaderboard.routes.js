'use strict';

const express = require('express');
const { pool } = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * Temporary Leaderboard
 *
 * Referral wallet has not been implemented yet,
 * so everyone has 0 referral earnings.
 */

router.get('/', auth, async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT
        email,
        0::bigint AS referral_earnings_cents
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    return res.json(rows);

  } catch (err) {

    console.error('Leaderboard error:', err);

    return res.status(500).json({
      error: 'Leaderboard failed'
    });

  }
});

module.exports = router;