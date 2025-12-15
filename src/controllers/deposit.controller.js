// src/controllers/deposit.controller.js
'use strict';

const depositService = require('../services/deposit.service');
const { requireLiveAccount } = require('../middlewares/accountGuards');
const { postTransaction } = require('../services/ledger.service');

exports.createDepositReference = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { amount_usd } = req.body;

    if (!amount_usd || amount_usd <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const ref = await depositService.generateDepositReference(userId, amount_usd);
    return res.json(ref);
  } catch (err) {
    console.error('createDepositReference error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.checkDeposits = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const list = await depositService.getUserDeposits(userId);
    return res.json(list);
  } catch (err) {
    console.error('checkDeposits error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * FINALIZE DEPOSIT
 * This is where ledger + live enforcement belongs
 */
exports.finalizeDeposit = async (req, res) => {
  try {
    const { account } = req; // injected by loadAccount middleware
    const { amount_cents } = req.body;

    requireLiveAccount(account);

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    await postTransaction({
      userId: req.user.id,
      accountId: account.id,
      type: 'deposit',
      amountCents: amount_cents
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('finalizeDeposit error', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};
