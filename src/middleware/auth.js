'use strict';

const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // Authorization header is required
  if (!header) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // Must be a Bearer token
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Validate payload
    const userId = Number(decoded.id);

    if (!Number.isInteger(userId)) {
      throw new Error('Invalid token payload');
    }

    // Attach authenticated user
    req.user = {
      id: userId,
      email: decoded.email || null,
      role: decoded.role || 'user'
    };

    return next();
  } catch (err) {
    console.error('auth middleware error:', err.message);
    return res.status(401).json({
      message: 'Unauthorized'
    });
  }
};