'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { approveDeposit } = require('../services/adminDeposit.service');
const { listDeposits } = require('../controllers/admin.deposit.controller');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.get(
  '/deposits',
  requireAuth,
  requireAdmin,
  adminLimiter,
  listDeposits
);

router.post(
  '/deposits/:id/approve',
  requireAuth,
  requireAdmin,
  adminLimiter,
  async (req, res) => {
    try {
      const depositId = req.params.id;
      const adminId = req.user.id;

      await approveDeposit(depositId, adminId);

      return res.json({ message: 'Deposit approved' });
    } catch (err) {
      console.error(err);
      return res.status(400).json({ message: err.message });
    }
  }
);

module.exports = router;