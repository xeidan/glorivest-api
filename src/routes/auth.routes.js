// src/routes/auth.routes.js
'use strict';


const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit');
const authCtrl = require('../controllers/auth.controller');

// -----------------------------
// PUBLIC ROUTES (Rate Limited)
// -----------------------------
router.post('/register', authLimiter, authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);

router.post('/send-otp', otpLimiter, authCtrl.sendOtp);
router.post('/verify-otp', authLimiter, authCtrl.verifyOtp);
router.post('/reset-password', authLimiter, authCtrl.resetPassword);

// -----------------------------
// AUTHENTICATED ROUTES
// -----------------------------
router.get('/me', requireAuth, authCtrl.me);
router.get('/devices', requireAuth, authCtrl.getDeviceHistory);

router.post('/change-password', requireAuth, authLimiter, authCtrl.changePassword);
router.post('/update-email/request', requireAuth, otpLimiter, authCtrl.requestEmailUpdate);
router.post('/update-email/confirm', requireAuth, authLimiter, authCtrl.confirmEmailUpdate);
router.post('/delete-account', requireAuth, authLimiter, authCtrl.deleteAccount);

module.exports = router;
