'use strict';
console.log('[AUTH HEADERS]', req.headers);

const jwt = require('jsonwebtoken');
const pool = require('../config/database').pool;
const { JWT_SECRET } = require('../config/env');


module.exports = function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔒 HARD GUARANTEE
    req.user = {
      id: Number(decoded.id),   // ⬅️ MUST BE NUMBER
      email: decoded.email
    };

    if (!Number.isInteger(req.user.id)) {
      throw new Error('Invalid user id in token');
    }

    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

