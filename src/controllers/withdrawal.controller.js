'use strict';

const withdrawalService = require('../services/withdrawal.service');

// ==========================
// Create Withdrawal
// ==========================
exports.requestWithdrawal = async (req, res) => {
  try {
    const { wallet_id, amount_usd, destination, method } = req.body;

    if (!wallet_id || !amount_usd || !destination || !method) {
      return res.status(400).json({
        message: 'wallet_id, amount_usd, destination and method required'
      });
    }

    if (!Number.isFinite(Number(amount_usd)) || Number(amount_usd) <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    if (typeof destination !== 'string' || destination.length < 5) {
      return res.status(400).json({ message: 'Invalid destination' });
    }

    const amount = Number(amount_usd);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: 'Invalid withdrawal amount'
      });
    }

    if (!['BANK', 'CRYPTO'].includes(method)) {
      return res.status(400).json({
        message: 'Invalid withdrawal method'
      });
    }

    const withdrawal = await withdrawalService.createWithdrawalRequest(
      req.user.id,
      wallet_id,
      amount,
      destination,
      method
    );

    return res.status(201).json(withdrawal);

  } catch (err) {
    console.error('requestWithdrawal error:', err);

    return res.status(400).json({
      message: err.message || 'Withdrawal request failed'
    });
  }
};

// ==========================
// Cancel Withdrawal
// ==========================
exports.cancelWithdrawal = async (req, res) => {
  try {
    await withdrawalService.cancelWithdrawal(
      req.user.id,
      req.params.id
    );

    return res.json({ message: 'Withdrawal cancelled' });

  } catch (err) {
    console.error('cancelWithdrawal error:', err);

    return res.status(400).json({
      message: err.message || 'Cancellation failed'
    });
  }
};

// ==========================
// List My Withdrawals
// ==========================
exports.myWithdrawals = async (req, res) => {
  try {
    const withdrawals = await withdrawalService.listUserWithdrawals(
      req.user.id
    );

    return res.json(withdrawals);

  } catch (err) {
    console.error('myWithdrawals error:', err);

    return res.status(500).json({
      message: 'Failed to fetch withdrawals'
    });
  }
};