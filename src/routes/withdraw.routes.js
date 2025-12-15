'use strict';

const router = require('express').Router();
const withdrawalCtrl = require('../controllers/withdrawal.controller');

const auth = require('../middleware/auth');
const loadAccount = require('../middleware/loadAccount');
const { requireLiveAccount } = require('../middleware/accountGuards');

// Request withdrawal (LIVE ONLY)
router.post(
  '/',
  auth,
  loadAccount,
  (req, res, next) => {
    try {
      requireLiveAccount(req.account); // 🔒 blocks demo
      next();
    } catch (e) {
      return res.status(e.status || 403).json({ message: e.message });
    }
  },
  withdrawalCtrl.requestWithdrawal
);

// List withdrawals (no restriction)
router.get(
  '/',
  auth,
  withdrawalCtrl.myWithdrawals
);

module.exports = router;
