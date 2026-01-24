'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const trade = require('../controllers/trade.controller');

// ===============================
// TRADE CYCLES
// ===============================
router.post('/start', requireAuth, trade.startTrade);
router.post('/stop', requireAuth, trade.stopTrade);

// ===============================
// OVERVIEWS
// ===============================
router.get('/summary', requireAuth, trade.getTradeSummary);
router.get('/overview', requireAuth, trade.getTradeOverview);
router.get('/history', requireAuth, trade.getTradeHistory);

// ===============================
// PROFITS
// ===============================
router.get('/profits', requireAuth, trade.getTradeProfits);
router.post('/transfer-profits', requireAuth, trade.transferTradeProfits);

module.exports = router;
