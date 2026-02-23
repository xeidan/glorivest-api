'use strict';

const {
  createBankDeposit,
  markDepositPaid
} = require('../services/deposit.service');

/**
 * Create a new bank deposit request
 */
async function createDeposit(req, res) {
  try {
    const userId = req.user.id;
    const { amount_cents } = req.body;

    if (!Number.isInteger(amount_cents) || amount_cents < 5000) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const deposit = await createBankDeposit(userId, amount_cents);

    return res.status(201).json(deposit);

  } catch (err) {
    console.error('createDeposit error:', err);
    return res.status(500).json({ message: 'Failed to create deposit' });
  }
}

/**
 * User marks deposit as paid
 */
async function markPaid(req, res) {
  try {
    const userId = req.user.id;
    const { depositId } = req.params;

    if (!depositId) {
      return res.status(400).json({ message: 'Deposit ID required' });
    }

    await markDepositPaid(userId, depositId);

    return res.json({ ok: true });

  } catch (err) {
    console.error('markPaid error:', err.message);

    if (err.message === 'Deposit not found') {
      return res.status(404).json({ message: err.message });
    }

    if (err.message === 'Invalid deposit state') {
      return res.status(400).json({ message: err.message });
    }

    return res.status(500).json({ message: 'Failed to update deposit' });
  }
}

module.exports = {
  createDeposit,
  markPaid
};