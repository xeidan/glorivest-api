'use strict';

const express = require('express');
const { transferProfits } = require('../controllers/transfer.controller');
const { transferLimiter } = require('../middleware/rateLimit');

const requireAuth = require('../middleware/auth');

const router = express.Router();

router.post('/profits', requireAuth, transferLimiter, transferProfits);


module.exports = router;
