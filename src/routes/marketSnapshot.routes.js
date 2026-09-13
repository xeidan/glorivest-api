'use strict';

const express = require('express');
const router = express.Router();

const {
  recordMarketSnapshot,
  getMarketCandles
} = require('../controllers/marketSnapshot.controller');

router.post('/', recordMarketSnapshot);
router.get('/candles', getMarketCandles);

module.exports = router;