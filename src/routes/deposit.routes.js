// src/routes/deposit.routes.js
const router = require('express').Router();

const auth = require('../middlewares/auth');
const loadAccount = require('../middlewares/loadAccount');
const { requireLiveAccount } = require('../middlewares/accountGuards');

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
