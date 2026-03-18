'use strict';

const { pool } = require('../config/database');

module.exports = async function requireAdmin(req, res, next) {
  try {
    // 🔴 ensure auth middleware worked
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized (no user)' });
    }

    const { rows } = await pool.query(
      `SELECT id, role FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized (user not found)' });
    }

    const role = rows[0].role;

    console.log('ADMIN CHECK:', {
      userId: req.user.id,
      roleFromDB: role
    });

    if (!role || role.toLowerCase() !== 'admin') {
      return res.status(403).json({
        message: `Admin access required. Your role: ${role}`
      });
    }

    // ✅ attach admin
    req.admin = rows[0];

    next();

  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Authorization failed' });
  }
};