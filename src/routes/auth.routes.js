// src/routes/auth.routes.js
'use strict';

const router = require('express').Router();
const authCtrl = require('../controllers/auth.controller');
const { authLimiter } = require('../config/rateLimiters');
const auth = require('../middleware/auth');


router.post('/register', authCtrl.register);
router.post('/login', authLimiter, authCtrl.login);

router.post('/send-otp', authCtrl.sendOtp);
router.post('/verify-otp', authCtrl.verifyOtp);
router.post('/resend-otp', authCtrl.resendOtp);
router.post('/reset-password', authCtrl.resetPassword);

router.get('/me', auth, authCtrl.me);

module.exports = router;
