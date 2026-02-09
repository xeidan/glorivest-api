'use strict';

const express = require('express');
const router = express.Router();
const  requireAuth  = require('../middleware/auth');
const { getUserPositions } = require('../controllers/positions.controller');

router.get('/', requireAuth, getUserPositions);

module.exports = router;
