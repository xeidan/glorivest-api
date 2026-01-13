'use strict';

const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/wallets', require('./wallet.routes'));
router.use('/transactions', require('./transactions.routes'));
router.use('/bot', require('./bot.routes'));
router.use('/leaderboard', require('./leaderboard.routes'));
router.use('/notify', require('./notify.routes'));
router.use('/accounts', require('./account.routes'));
router.use('/cycle', require('./cycle.routes'));

module.exports = router;
