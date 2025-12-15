// src/routes/deposit.routes.js
const router = require('express').Router();

const auth = require('../middleware/auth');
const loadAccount = require('../middleware/loadAccount');
const { requireLiveAccount } = require('../middleware/accountGuards');

const depositController = require('../controllers/deposit.controller');

router.post(
  '/',
  auth,
  loadAccount,
  requireLiveAccount,
  depositController.createDepositReference
);

router.get(
  '/',
  auth,
  depositController.checkDeposits
);

module.exports = router;
