'use strict';

const pool = require('../config/database').pool;

exports.getLeaderboard = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        SUM(a.balance_cents + a.profit_cents) AS total_cents
      FROM users u
      JOIN accounts a ON a.user_id = u.id
      GROUP BY u.id
      ORDER BY total_cents DESC
      LIMIT 20
    `);

    return res.json(
      rows.map(r => ({
        user_id: r.id,
        email: r.email,
        total_balance: Number(r.total_cents) / 100
      }))
    );
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
