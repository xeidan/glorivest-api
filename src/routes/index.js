'use strict';

console.log('✅ routes/index.js loaded');

const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth');
const { getPerformanceSummary } = require('../controllers/performance.controller');

// AUTH
router.use('/auth', require('./auth.routes'));

// CORE
router.use('/accounts', require('./account.routes'));
router.use('/trades', require('./trade.routes'));
router.use('/wallets', require('./wallet.routes'));
router.use('/cycle', require('./cycle.routes'));
router.use('/transfer', require('./transfer.routes'));
router.use('/performance', require('./performance.routes'));

// Optional summary endpoint
router.get('/performance/summary', authMiddleware, getPerformanceSummary);

router.use('/market-snapshot', require('./marketSnapshot.routes'));

module.exports = router;
