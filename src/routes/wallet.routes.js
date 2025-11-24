// src/routes/wallet.routes.js
'use strict';

const router = require('express').Router();
const walletCtrl = require('../controllers/wallet.controller');
const auth = require('../middleware/auth');

router.get('/', auth, walletCtrl.getWallet);
router.post('/create', auth, walletCtrl.createTronWallet);

module.exports = router;
