'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

const { approveDeposit } = require('../services/adminDeposit.service');
const { approveWithdrawal } = require('../services/withdrawal.service');
const { listDeposits, listWithdrawals } = require('../controllers/admin.deposit.controller');

// ==========================
// Admin Rate Limiter
// ==========================
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

//  
const {
  getSettings,
  updateSettings
} = require('../controllers/admin.settings.controller');

// Apply base middleware to all admin routes
router.use(requireAuth);
router.use(requireAdmin);
router.use(adminLimiter);


// ==========================
// List Deposits, Withdrawals (Admin Queue)
// ==========================
router.get('/deposits', listDeposits);
router.get('/withdrawals', listWithdrawals);


// ==========================
// Approve Deposit
// ==========================
router.post(
  '/deposits/:id/approve',
  async (req, res) => {
    try {
      await approveDeposit(req.params.id, req.admin.id);
      return res.json({ message: 'Deposit approved' });
    } catch (err) {
      console.error('approveDeposit error:', err);
      return res.status(400).json({ message: err.message });
    }
  }
);

// ==========================
// Approve Withdrawal
// ==========================
router.post(
  '/withdrawals/:id/approve',
  async (req, res) => {
    try {
      await approveWithdrawal(req.params.id, req.admin.id);
      return res.json({ message: 'Withdrawal approved' });
    } catch (err) {
      console.error('approveWithdrawal error:', err);
      return res.status(400).json({ message: err.message });
    }
  }
);


// ==========================
// Platform Settings
// ==========================

router.get(
  '/settings',
  getSettings
);

router.put(
  '/settings',
  updateSettings
);

module.exports = router;