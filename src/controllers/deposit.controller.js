'use strict';

const depositService = require('../services/deposit.service');

// ==========================
// Create Deposit
// ==========================
exports.createDeposit = async (req, res) => {
  try {
    const { amount_cents } = req.body;

    if (!amount_cents || Number(amount_cents) <= 0) {
      return res.status(400).json({
        message: 'Valid amount_cents required'
      });
    }

    const deposit = await depositService.createBankDeposit(
      req.user.id,
      Number(amount_cents)
    );

    return res.status(201).json(deposit);

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

// ==========================
// Mark Deposit Paid
// ==========================
exports.markPaid = async (req, res) => {
  try {
    await depositService.markDepositPaid(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Marked as paid' });

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

// ==========================
// Cancel Deposit
// ==========================
exports.cancelDeposit = async (req, res) => {
  try {
    await depositService.cancelDeposit(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Deposit cancelled' });

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

// ==========================
// List User Deposits
// ==========================
exports.listUserDeposits = async (req, res) => {
  try {
    const deposits = await depositService.listUserDeposits(
      req.user.id
    );

    return res.json(deposits);

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};


module.exports = {
  createDeposit,
  markPaid,
  listUserDeposits,
  cancelDeposit
};