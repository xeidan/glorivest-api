'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const tradeController = require('../controllers/trade.controller');

router.post('/start', requireAuth, tradeController.startTrade);
router.post('/complete', requireAuth, tradeController.completeCycle);

module.exports = router;
