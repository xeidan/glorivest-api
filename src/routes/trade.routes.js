'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
router.post('/start', requireAuth, trade.startTrade);
router.post('/stop', requireAuth, trade.stopTrade);
router.get('/overview', requireAuth, trade.getTradeOverview);
router.get('/summary', requireAuth, trade.getTradeSummary);
router.get('/active', requireAuth, trade.getActiveCycles);
router.get('/history', requireAuth, trade.getTradeHistory);
router.get('/profits', requireAuth, trade.getTransferableProfits);
router.post('/transfer-profits', requireAuth, trade.transferTradeProfits);
router.get('/positions', requireAuth, trade.getPositions);

module.exports = router;
