'use strict';

const db = require('../db');

module.exports = async function requireAdmin(req, res, next) {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(
      `SELECT role FROM users WHERE id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (rows[0].role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Authorization failed' });
  }
};