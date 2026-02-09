'use strict';

const express = require('express');
const router = express.Router();

const controller = require('../controllers/marketSnapshot.controller');

if (!controller || typeof controller.recordMarketSnapshot !== 'function') {
  throw new Error('recordMarketSnapshot controller not loaded');
}

router.post('/market-snapshot', controller.recordMarketSnapshot);

module.exports = router;
