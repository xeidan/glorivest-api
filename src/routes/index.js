'use strict';

const express = require('express');
const router = express.Router();

router.use('/accounts', require('./account.routes'));
router.use('/trades', require('./trade.routes'));

module.exports = router;
