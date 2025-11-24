// src/routes/deposit.routes.js
'use strict';

const router = require('express').Router();
const depositCtrl = require('../controllers/deposit.controller');
const auth = require('../middleware/auth');

router.post('/reference', auth, depositCtrl.createDepositReference);
router.get('/', auth, depositCtrl.checkDeposits);

module.exports = router;
