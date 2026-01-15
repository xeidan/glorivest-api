'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const walletController = require('../controllers/wallet.controller');

router.get('/', auth, walletController.getWallets);
router.post('/:id/demo-reset', auth, walletController.resetDemoWallet);
router.post('/referral-transfer', auth, walletController.transferReferralToReal);

module.exports = router;
