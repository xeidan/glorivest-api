// src/routes/auth.routes.js
'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const authCtrl = require('../controllers/auth.controller');

// -----------------------------
// PUBLIC ROUTES
// -----------------------------
router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);

router.post('/send-otp', authCtrl.sendOtp);
router.post('/verify-otp', authCtrl.verifyOtp);
router.post('/reset-password', authCtrl.resetPassword);

// -----------------------------
// AUTHENTICATED ROUTES
// -----------------------------
router.get('/me', requireAuth, authCtrl.me);
router.get('/devices', requireAuth, authCtrl.getDeviceHistory);

router.post('/change-password', requireAuth, authCtrl.changePassword);
router.post('/update-email/request', requireAuth, authCtrl.requestEmailUpdate);
router.post('/update-email/confirm', requireAuth, authCtrl.confirmEmailUpdate);
router.post('/delete-account', requireAuth, authCtrl.deleteAccount);


module.exports = router;
