// src/middleware/auth.js
'use strict';

const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // 1️⃣ Header must exist
  if (!header) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // 2️⃣ Must be Bearer token
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // 3️⃣ Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4️⃣ Validate payload shape strictly
    const userId = Number(decoded.id);
    if (!Number.isInteger(userId)) {
      throw new Error('Invalid token payload');
    }

    // 5️⃣ Attach trusted user context
    req.user = {
      id: userId,
      email: decoded.email || null
    };

    next();
  } catch (err) {
    // 🔍 This log is intentional and useful
    console.error('auth middleware error:', err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
  console.log('JWT_SECRET:', process.env.JWT_SECRET);
};
