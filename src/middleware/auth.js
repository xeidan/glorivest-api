// src/middleware/auth.js
'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { pool } = require('../config/database');

module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ message: 'Missing token' });

    const token = header.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const q = await pool.query(
      'SELECT id, email, balance, bot_active FROM users WHERE id=$1 LIMIT 1',
      [decoded.id]
    );

    if (!q.rows.length)
      return res.status(401).json({ message: 'Invalid token' });

    req.user = q.rows[0];
    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
