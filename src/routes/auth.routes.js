// src/routes/auth.routes.js
'use strict';

const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { authLimiter } = require('../config/rateLimiters');
const auth = require('../middleware/auth');

// Public routes
router.post('/register', authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);

router.post('/send-otp', authCtrl.sendOtp);
router.post('/verify-otp', authCtrl.verifyOtp);
router.post('/resend-otp', authCtrl.resendOtp);
router.post('/reset-password', authCtrl.resetPassword);

// NEW secure routes (corrected)
router.post('/auth/update-email/request', auth, authCtrl.requestEmailUpdate);
router.post('/auth/update-email/confirm', auth, authCtrl.confirmEmailUpdate);
router.get('/auth/devices', auth, authCtrl.getDeviceHistory);
router.post('/auth/delete-account', auth, authCtrl.deleteAccount);

// Authenticated user profile
router.get('/me', auth, authCtrl.me);

module.exports = router;
