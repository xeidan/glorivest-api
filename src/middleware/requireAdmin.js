'use strict';

const { pool } = require('../config/database');

module.exports = async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { rows } = await pool.query(
      `SELECT role FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const role = rows[0].role;

    // ✅ Case-insensitive check (prevents ADMIN/admin issues)
    if (!role || role.toLowerCase() !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();

  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Authorization failed' });
  }
};