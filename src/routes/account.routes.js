'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const loadAccount = require('../middleware/loadAccount');
const guardRoute = require('../middleware/guardRoute');

const {
  requireDemoAccount
} = require('../middleware/accountGuards');

const accountController = require('../controllers/account.controller');

// ==================================================
// DASHBOARD CORE
// ==================================================

// GET /api/accounts
router.get(
  '/',
  auth,
  accountController.getMyAccounts
);

// GET /api/accounts/me
router.get(
  '/me',
  auth,
  accountController.getAccountById
);

// ==================================================
// DEMO ONLY
// ==================================================

// POST /api/accounts/:accountId/demo-reset
router.post(
  '/:accountId/demo-reset',
  auth,
  loadAccount,
  guardRoute(requireDemoAccount),
  accountController.resetDemo
);

module.exports = router;