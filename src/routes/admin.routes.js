'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

const {
  approveDeposit
} = require('../services/adminDeposit.service');

const {
  approveWithdrawal
} = require('../services/withdrawal.service');

const {
  listDeposits,
  listWithdrawals
} = require('../controllers/admin.deposit.controller');

const {
  getSettings,
  updateSettings
} = require('../controllers/admin.settings.controller');

const router = express.Router();

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.use(requireAuth);
router.use(requireAdmin);
router.use(adminLimiter);

// Deposits
router.get('/deposits', listDeposits);

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    await approveDeposit(req.params.id, req.admin.id);

    return res.json({
      success: true,
      message: 'Deposit approved'
    });
  } catch (err) {
    console.error('approveDeposit error:', err);

    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

// Withdrawals
router.get('/withdrawals', listWithdrawals);

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    await approveWithdrawal(req.params.id, req.admin.id);

    return res.json({
      success: true,
      message: 'Withdrawal approved'
    });
  } catch (err) {
    console.error('approveWithdrawal error:', err);

    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

// Platform settings
router.get('/settings', getSettings);

router.put('/settings', updateSettings);

module.exports = router;