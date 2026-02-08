'use strict';

const express = require('express');
const { transferProfits } = require('../controllers/transfer.controller');
const requireAuth = require('../middleware/auth');

const router = express.Router();

router.post('/profits', requireAuth, transferProfits);

module.exports = router;
