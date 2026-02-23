'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const {
  createDeposit,
  markDepositPaid
} = require('../controllers/deposit.controller');

// Create deposit
router.post('/', requireAuth, createDeposit);

// Mark deposit as paid
router.post('/:depositId/mark-paid', requireAuth, markDepositPaid);

module.exports = router;