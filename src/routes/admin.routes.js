'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
// const requireAdmin = require('../middleware/requireAdmin'); // TEMPORARILY DISABLED

const { approveDeposit } = require('../services/adminDeposit.service');

/**
 * TEMPORARY:
 * Admin middleware disabled for financial engine testing.
 * Restore requireAdmin before production.
 */
router.post(
  '/deposits/:id/approve',
  requireAuth,
  // requireAdmin, // ← re-enable later
  async (req, res) => {
    try {
      const depositId = req.params.id;
      const adminId = req.user.id; // still tracked

      await approveDeposit(depositId, adminId);

      return res.json({ message: 'Deposit approved' });

    } catch (err) {
      console.error('approveDeposit error:', err.message);
      return res.status(400).json({ message: err.message });
    }
  }
);

module.exports = router;