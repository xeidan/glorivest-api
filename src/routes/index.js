'use strict';

const express = require('express');
const router = express.Router();

// AUTH
router.use('/auth', require('./auth.routes'));

// CORE
router.use('/accounts', require('./account.routes'));
router.use('/trades', require('./trade.routes'));
router.use('/wallets', require('./wallet.routes'));
router.use('/cycle', require('./cycle.routes'));
router.use('/transfer', require('./transfer.routes'));
router.use('/positions', require('./positions.routes'));


module.exports = router;
