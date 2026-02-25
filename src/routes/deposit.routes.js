'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');

const {
  createDeposit,
  markPaid,
  listUserDeposits,
  cancelDeposit
} = require('../controllers/deposit.controller');

// ==========================
// Create Deposit
// ==========================
router.post('/', requireAuth, createDeposit);

// ==========================
// Mark Deposit Paid
// ==========================
router.post('/:depositId/mark-paid', requireAuth, markPaid);

// ==========================
// Cancel Deposit
// ==========================
router.post('/:depositId/cancel', requireAuth, cancelDeposit);

// ==========================
// List User Deposits
// ==========================
router.get('/', requireAuth, listUserDeposits);

module.exports = router;