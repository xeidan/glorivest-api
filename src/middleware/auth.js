'use strict';

const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { JWT_SECRET } = require('../config/env');

module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = header.slice(7);
    let payload;

    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [payload.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'User not found' });
    }

    // 🔑 minimal user object only
    req.user = {
      id: rows[0].id,
      email: rows[0].email
    };

    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
