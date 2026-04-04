'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

/*
|--------------------------------------------------------------------------
| Public / Auth Routes
|--------------------------------------------------------------------------
*/
router.use('/auth', require('./auth.routes'));


/*
|--------------------------------------------------------------------------
| User Core Routes
|--------------------------------------------------------------------------
*/
router.use('/accounts', require('./account.routes'));
router.use('/wallets', require('./wallet.routes'));
router.use('/trades', require('./trade.routes'));
router.use('/cycle', require('./cycle.routes'));
router.use('/transfer', require('./transfer.routes'));
router.use('/deposit', require('./deposit.routes'));
router.use('/withdrawals', require('./withdrawal.routes'));
router.use('/performance', require('./performance.routes'));
router.use('/leaderboard', require('./leaderboard.routes'));
router.use('/rates', require('./rates.routes'));



/*
|--------------------------------------------------------------------------
| Admin Routes
|--------------------------------------------------------------------------
*/
router.use('/admin', auth, requireAdmin, require('./admin.routes'));


module.exports = router;