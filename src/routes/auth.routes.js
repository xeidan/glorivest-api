// src/routes/auth.routes.js
'use strict';

const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { authLimiter } = require('../config/rateLimiters');
const auth = require('../middleware/auth');

router.post('/register', authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);

// NEW OTP / reset endpoints
router.post('/send-otp', authCtrl.sendOtp);         // send OTP for verification or reset (body: { email, purpose })
router.post('/verify-otp', authCtrl.verifyOtp);     // verify OTP (body: { email, code, purpose })
router.post('/resend-otp', authCtrl.resendOtp);     // resend OTP (body: { email, purpose })
router.post('/reset-password', authCtrl.resetPassword); // reset password using otp (body: { email, code, newPassword })

router.get('/me', auth, authCtrl.me);

module.exports = router;

console.log('AUTH CTRL EXPORTS:', authCtrl);
