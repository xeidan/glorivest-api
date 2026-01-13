'use strict';

const Router = require('express').Router;

const authRoutes = require('./auth.routes');
const walletRoutes = require('./wallet.routes');
const depositRoutes = require('./deposit.routes');
const withdrawalRoutes = require('./withdraw.routes');
const transactionsRoutes = require('./transactions.routes');
const cycleRoutes = require('./cycle.routes');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/wallets', require('./wallet.routes'));
router.use('/transactions', require('./transactions.routes'));
router.use('/bot', require('./bot.routes'));
router.use('/leaderboard', require('./leaderboard.routes'));
router.use('/notify', require('./notify.routes'));
router.use('/accounts', require('./account.routes'));
router.use('/cycle', require('./cycle.routes'));

module.exports = router;
