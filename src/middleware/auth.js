'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../config/database').pool;
const { JWT_SECRET } = require('../config/env');

module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = rows[0]; // 👈 NO balance, NO verified
    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
