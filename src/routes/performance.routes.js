'use strict';

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');

const {
  getUserPerformance,
  getUserPerformanceAnalytics
} = require('../controllers/performance.controller');

router.get('/', requireAuth, getUserPerformance);
router.get('/analytics', requireAuth, getUserPerformanceAnalytics);

module.exports = router;
