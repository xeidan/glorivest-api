'use strict';

const express = require('express');
const router = express.Router();
const  requireAuth  = require('../middleware/auth');
const { getUserPositions, getPositionsAnalytics } = require('../controllers/positions.controller');


router.get('/', requireAuth, getUserPositions);
router.get('/analytics', requireAuth, getPositionsAnalytics);
module.exports = router;
