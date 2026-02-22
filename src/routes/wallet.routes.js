'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { getWallets, resetDemoWalletController, transferReferralToReal } = require('../controllers/wallet.controller');

router.get('/', requireAuth, getWallets);
router.post('/:id/demo-reset', requireAuth, resetDemoWalletController);
router.post('/referral-transfer', requireAuth, transferReferralToReal);

module.exports = router;
