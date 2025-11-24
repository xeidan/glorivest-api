// src/routes/index.js
'use strict';

const Router = require('express').Router;

const authRoutes = require('./auth.routes');
const accountRoutes = require('./account.routes');
const walletRoutes = require('./wallet.routes');
const depositRoutes = require('./deposit.routes');
const withdrawalRoutes = require('./withdraw.routes');
const botRoutes = require('./bot.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const notifyRoutes = require('./notify.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/accounts', accountRoutes);
router.use('/wallet', walletRoutes);
router.use('/deposits', depositRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/bot', botRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/notify', notifyRoutes);

module.exports = router;
