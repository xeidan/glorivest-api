'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');

// ===============================
// TRADE CYCLES
// ===============================

// start a trade cycle
router.post('/start', requireAuth, trade.startTrade);

// stop a running cycle
router.post('/stop', requireAuth, trade.stopTrade);

// ===============================
// OVERVIEWS / LISTS
// ===============================

// summary numbers (top cards)
router.get('/summary', requireAuth, trade.getTradeSummary);

// active running cycles
router.get('/active', requireAuth, trade.getActiveTrades);

// full overview (active + completed)
router.get('/overview', requireAuth, trade.getTradeOverview);

// trade history
router.get('/history', requireAuth, trade.getTradeHistory);

// ===============================
// PROFITS
// ===============================

// profits waiting to be transferred
router.get('/profits', requireAuth, trade.getTradeProfits);

// transfer profits to real wallet
router.post('/transfer-profits', requireAuth, trade.transferTradeProfits);

// ===============================
// POSITIONS
// ===============================

// bot positions (open + closed)
router.get('/positions', requireAuth, trade.getPositions);

module.exports = router;
