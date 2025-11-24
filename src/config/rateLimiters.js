// src/config/rateLimiters.js
// Useful rate-limiters used by routes
'use strict';

const rateLimit = require('express-rate-limit');

/**
 * General API limiter (for unauthenticated endpoints)
 * Adjust windowMax and windowMs to your traffic expectations.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_API || 60), // requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, slow down.' },
});

/**
 * OTP resend limiter (tight)
 * Used on /resend-otp and similar endpoints.
 */
const otpResendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Wait a minute before resending OTP.' },
});

/**
 * Auth brute-force limiter (login attempts)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_AUTH || 10),
  message: { message: 'Too many login attempts, try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  otpResendLimiter,
  authLimiter,
};
