// src/routes/withdrawal.routes.js
'use strict';

const router = require('express').Router();
const withdrawalCtrl = require('../controllers/withdrawal.controller');
const auth = require('../middleware/auth');

router.post('/', auth, withdrawalCtrl.requestWithdrawal);
router.get('/', auth, withdrawalCtrl.myWithdrawals);

module.exports = router;
