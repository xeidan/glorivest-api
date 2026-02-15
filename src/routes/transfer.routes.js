'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { transferProfits } = require('../controllers/transfer.controller');

router.post('/profits', requireAuth, transferProfits);

module.exports = router;
