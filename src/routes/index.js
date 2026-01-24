'use strict';

const express = require('express');
const router = express.Router();

// AUTH
router.use('/auth', require('./auth.routes'));

// CORE
router.use('/accounts', require('./account.routes'));
router.use('/trades', require('./trade.routes'));

module.exports = router;
