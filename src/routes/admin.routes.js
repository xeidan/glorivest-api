'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { approveDeposit } = require('../services/adminDeposit.service');

router.post(
  '/deposits/:id/approve',
  requireAuth,
  requireAdmin,
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