'use strict';

const {
  createBankDeposit,
  markDepositPaid
} = require('../services/deposit.service');

async function createDeposit(req, res) {
  try {
    const userId = req.user.id;
    const { amount_cents } = req.body;

    if (!amount_cents || amount_cents < 5000) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const deposit = await createBankDeposit(userId, amount_cents);

    res.json(deposit);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create deposit' });
  }
}

async function markPaid(req, res) {
  try {
    const userId = req.user.id;
    const { depositId } = req.params;

    await markDepositPaid(userId, depositId);

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update deposit' });
  }
}

module.exports = {
  createDeposit,
  markPaid
};