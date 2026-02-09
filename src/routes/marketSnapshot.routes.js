'use strict';

const express = require('express');
const router = express.Router();

const {
  recordMarketSnapshot
} = require('../controllers/marketSnapshot.controller');

router.post('/market-snapshot', recordMarketSnapshot);

module.exports = router;
