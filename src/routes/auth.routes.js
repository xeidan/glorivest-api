// src/routes/auth.routes.js
'use strict';

const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { authLimiter } = require('../config/rateLimiters');
const auth = require('../middleware/auth');
console.log('AUTH CONTROLLER EXPORTS:', Object.keys(authController));

// Public routes
router.post('/register', authCtrl.register);

router.post('/login', (req, res, next) => {
  console.log('Login hit');
  next();
});

router.post('/login', authLimiter, authCtrl.login);

router.post('/send-otp', authCtrl.sendOtp);
router.post('/verify-otp', authCtrl.verifyOtp);
router.post('/resend-otp', authCtrl.resendOtp);
router.post('/reset-password', authCtrl.resetPassword);

// NEW secure routes (corrected)
router.post('/change-password', auth, authCtrl.changePassword);
router.post('/update-email/request', auth, authCtrl.requestEmailUpdate);
router.post('/update-email/confirm', auth, authCtrl.confirmEmailUpdate);
router.get('/devices', auth, authCtrl.getDeviceHistory);
router.post('/delete-account', auth, authCtrl.deleteAccount);


// Authenticated user profile
router.get('/me', auth, authCtrl.me);

module.exports = router;
