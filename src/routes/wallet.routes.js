// src/routes/wallet.routes.js
'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const walletController = require('../controllers/wallet.controller');

// list wallets
router.get('/', auth, walletController.getWallets);

// reset demo wallet
router.post(
  '/:walletId/demo-reset',
  auth,
  walletController.resetDemoWallet
);

module.exports = router;

