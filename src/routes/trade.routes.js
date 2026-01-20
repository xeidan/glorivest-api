'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const trade = require('../controllers/trade.controller');

// ===============================
// TRADE LIFECYCLE
// ===============================

// Start a new trade cycle
router.post('/start', requireAuth, trade.startTrade);

// Stop a running cycle early
router.post('/stop', requireAuth, trade.stopTrade);

// ===============================
// OVERVIEW & DASHBOARD
// ===============================

// Full overview (summary + active + completed)
router.get('/overview', requireAuth, trade.getTradeOverview);

// Lightweight summary (numbers only)
router.get('/summary', requireAuth, trade.getTradeSummary);

// Active cycles list
router.get('/active', requireAuth, trade.getActiveCycles);

// Trade history (completed / stopped)
router.get('/history', requireAuth, trade.getTradeHistory);

// ===============================
// PROFITS & TRANSFERS
// ===============================

// Transferable profits list
router.get('/profits', requireAuth, trade.getTransferableProfits);

// Transfer profits to REAL wallet
router.post('/transfer-profits', requireAuth, trade.transferTradeProfits);

// ===============================
// POSITIONS
// ===============================

// Bot positions (open + closed)
router.get('/positions', requireAuth, trade.getPositions);

module.exports = router;
