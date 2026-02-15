'use strict';

const { pool } = require('../config/database');

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT is_admin FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows.length || rows[0].is_admin !== true) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = requireAdmin;
