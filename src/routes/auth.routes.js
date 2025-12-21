// src/routes/auth.routes.js
'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
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
router.get('/me', auth, authCtrl.me);
router.get('/devices', auth, authCtrl.getDeviceHistory);

router.post('/change-password', auth, authCtrl.changePassword);
router.post('/update-email/request', auth, authCtrl.requestEmailUpdate);
router.post('/update-email/confirm', auth, authCtrl.confirmEmailUpdate);
router.post('/delete-account', auth, authCtrl.deleteAccount);

module.exports = router;
