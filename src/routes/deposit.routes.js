'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');

const {
  createDeposit,
  markPaid
} = require('../controllers/deposit.controller');

router.post('/', requireAuth, createDeposit);
router.post('/:depositId/mark-paid', requireAuth, markPaid);

module.exports = router;