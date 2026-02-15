'use strict';

const rateLimit = require('express-rate-limit');

// General auth limiter (login, register, reset, etc.)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Try again later.'
  }
});

// OTP limiter (stricter)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // max 5 OTP requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many OTP attempts. Try again later.'
  }
});

module.exports = {
  authLimiter,
  otpLimiter
};
