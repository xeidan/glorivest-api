// src/controllers/leaderboard.controller.js
'use strict';

const { pool } = require('../config/database');

// Returns top users ranked by balance (default)
exports.getLeaderboard = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);

    const q = await pool.query(
      `
      SELECT 
        id,
        email,
        balance,
        bot_active,
        COALESCE(total_earnings, 0) AS total_earnings
      FROM users
      ORDER BY balance DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.json({
      count: q.rows.length,
      data: q.rows,
    });

  } catch (err) {
    console.error('leaderboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Leaderboard by earnings
exports.getTopEarners = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);

    const q = await pool.query(
      `
      SELECT 
        id,
        email,
        balance,
        bot_active,
        COALESCE(total_earnings, 0) AS total_earnings
      FROM users
      ORDER BY total_earnings DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.json({
      count: q.rows.length,
      data: q.rows,
    });

  } catch (err) {
    console.error('top earners error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
