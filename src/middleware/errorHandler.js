// src/middleware/errorHandler.js
'use strict';

module.exports = (err, req, res, next) => {
  console.error('❌ Uncaught Error:', err);

  if (res.headersSent) return next(err);

  return res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};
