'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

module.exports = function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = {
      id: Number(decoded.id),
      email: decoded.email
    };

    if (!Number.isInteger(req.user.id)) {
      throw new Error('Invalid user id in token');
    }

    next();
  } catch (err) {
    console.error('auth middleware error:', err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
