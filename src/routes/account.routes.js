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
// DASHBOARD CORE
// ==================================================

// GET /accounts → list user accounts
router.get(
  '/',
  auth,
  accountController.getMyAccounts
);

// GET /accounts/me → current active account
router.get(
  '/me',
  auth,
  accountController.getAccountById
);

// ==================================================
// DEMO ONLY
// ==================================================

// POST /accounts/:accountId/demo-reset
router.post(
  '/:accountId/demo-reset',
  auth,
  loadAccount,
  guardRoute(requireDemoAccount),
  accountController.resetDemo
);

// ==================================================
// LIVE ONLY
// ==================================================

// POST /accounts/:accountId/withdraw
router.post(
  '/:accountId/withdraw',
  auth,
  loadAccount,
  guardRoute(requireLiveAccount),
  withdrawalController.requestWithdrawal
);

module.exports = router;
