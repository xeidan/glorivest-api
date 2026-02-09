'use strict';

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const {
  recordMarketSnapshot
} = require('../controllers/marketSnapshot.controller');

router.post('/', requireAuth, recordMarketSnapshot);

module.exports = router;
