'use strict';

const express = require('express');
const router = express.Router();

// ==========================
// Middleware
// ==========================
const auth = require('../middleware/auth');
const loadAccount = require('../middleware/loadAccount');
const guardRoute = require('../middleware/guardRoute');

const {
  requireDemoAccount,
  requireLiveAccount
} = require('../middleware/accountGuards');

// ==========================
// Controllers
// ==========================
const accountController = require('../controllers/account.controller');
const withdrawalController = require('../controllers/withdrawal.controller');

console.log('accountController:', accountController);
console.log('withdrawalController:', withdrawalController);


// ==========================
// DASHBOARD CORE
// ==========================

// GET /accounts
// Used by dashboard.js to list user accounts
router.get(
  '/',
  auth,
  accountController.getAccounts
);

// GET /accounts/me
// Returns current account summary (header/dashboard)
router.get(
  '/me',
  auth,
  accountController.me
);

// ==========================
// DEMO ACCOUNT
// ==========================

// POST /accounts/:accountId/demo-reset
// Reset demo balance to default
router.post(
  '/:accountId/demo-reset',
  auth,
  loadAccount,
  guardRoute(requireDemoAccount),
  accountController.resetDemo
);

// ==========================
// LIVE ACCOUNT
// ==========================

// POST /accounts/:accountId/withdraw
// Request withdrawal from live account
router.post(
  '/:accountId/withdraw',
  auth,
  loadAccount,
  guardRoute(requireLiveAccount),
  withdrawalController.requestWithdrawal
);

module.exports = router;
