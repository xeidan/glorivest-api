'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');

const {
  requestWithdrawal,
  myWithdrawals,
  cancelWithdrawal
} = require('../controllers/withdrawal.controller');

// ==========================
// Create Withdrawal Request
// ==========================
router.post(
  '/',
  requireAuth,
  requestWithdrawal
);

// ==========================
// List User Withdrawals
// ==========================
router.get(
  '/',
  requireAuth,
  myWithdrawals
);

// ==========================
// Cancel Withdrawal
// ==========================
router.post(
  '/:id/cancel',
  requireAuth,
  cancelWithdrawal
);

module.exports = router;