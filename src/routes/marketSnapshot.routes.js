'use strict';

const express = require('express');
const router = express.Router();

const {
  getMarketCandles
} = require('../controllers/marketSnapshot.controller');

router.get('/candles', getMarketCandles);

module.exports = router;