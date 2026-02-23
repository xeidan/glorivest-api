'use strict';

const express = require('express');
const router = express.Router();

const {
  createDeposit,
  markPaid
} = require('../controllers/deposit.controller');

const { authenticate } = require('../middlewares/auth.middleware');

// Create deposit
router.post('/', authenticate, createDeposit);

// Mark deposit as paid
router.post('/:depositId/mark-paid', authenticate, markPaid);

module.exports = router;