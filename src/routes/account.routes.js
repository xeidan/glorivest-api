'use strict';

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
const withdrawalController = require('../controllers/withdrawal.controller');

// ==================================================
// DASHBOARD CORE (WHAT WAS MISSING)
// ==================================================

// ✅ Used by dashboard.js → GET /accounts
router.get(
  '/',
  auth,
  accountController.getAccounts
);

// ✅ Used by dashboard.js → GET /account/me
router.get(
  '/me',
  auth,
  accountController.me
);

// ==================================================
// DEMO-ONLY: Reset demo balance
// ==================================================
router.post(
  '/:accountId/demo-reset',
  auth,
  loadAccount,
  guardRoute(requireDemoAccount),
  accountController.resetDemo
);

// ==================================================
// LIVE-ONLY: Withdraw funds
// ==================================================
router.post(
  '/:accountId/withdraw',
  auth,
  loadAccount,
  requireLiveAccount,
  withdrawalController.requestWithdrawal
);

module.exports = router;
