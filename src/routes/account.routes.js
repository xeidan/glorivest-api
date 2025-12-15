const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const loadAccount = require('../middleware/loadAccount');
const guardRoute = require('../middleware/guardRoute');

const {
  requireDemoAccount,
  requireLiveAccount
} = require('../middleware/accountGuards');

const accountController = require('../controllers/account.controller');
const withdrawalController = require('../controllers/withdrawal.controller'); // 🔑 FIX

// --------------------------------------------------
// DEMO-ONLY: Reset demo balance
// --------------------------------------------------
router.post(
  '/accounts/:accountId/demo-reset',
  auth,
  loadAccount,
  guardRoute(requireDemoAccount),
  accountController.resetDemo
);

// --------------------------------------------------
// LIVE-ONLY: Withdraw funds
// --------------------------------------------------
router.post(
  '/accounts/:accountId/withdraw',
  auth,
  loadAccount,
  requireLiveAccount,
  withdrawalController.requestWithdrawal
);

module.exports = router;