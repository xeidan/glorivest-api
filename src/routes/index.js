'use strict';

const Router = require('express').Router;

const authRoutes = require('./auth.routes');
const walletRoutes = require('./wallet.routes');
const depositRoutes = require('./deposit.routes');
const withdrawalRoutes = require('./withdraw.routes');
const transactionsRoutes = require('./transactions.routes');
const cycleRoutes = require('./cycle.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/wallets', walletRoutes);
router.use('/deposit', depositRoutes);
router.use('/withdraw', withdrawalRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/cycle', cycleRoutes);

module.exports = router;
