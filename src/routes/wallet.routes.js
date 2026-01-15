'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const walletController = require('../controllers/wallet.controller');

router.get('/', auth, walletController.getWallets);
router.post('/:walletId/demo-reset', auth, walletController.resetDemoWallet);

module.exports = router;
