'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const trade = require('../controllers/trade.controller');

router.post('/start', requireAuth, trade.startTrade);

router.get('/summary', requireAuth, trade.getTradeSummary);
router.get('/active', requireAuth, trade.getActiveTrades);

router.post('/stop', requireAuth, trade.stopTrade);

router.get('/profits', requireAuth, trade.getTradeProfits);
router.post('/transfer-profits', requireAuth, trade.transferTradeProfits);

router.get('/active', requireAuth, tradeController.getActiveCycles);
router.get('/summary', requireAuth, tradeController.getTradeSummary);
router.get('/history', requireAuth, tradeController.getTradeHistory);
router.get('/profits', requireAuth, tradeController.getTransferableProfits);
router.post('/transfer-profits', requireAuth, tradeController.transferTradeProfits);
router.get('/overview', requireAuth, tradeController.getTradeOverview);

router.get('/', requireAuth, controller.getPositions);


module.exports = router;
