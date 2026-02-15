'use strict';

const { transferToMainWallet } = require('../services/walletTransfer.service');

async function transferProfits(req, res) {
  try {
    const userId = req.user.id;
    const { amount_cents, source } = req.body || {};

    if (!source) {
      return res.status(400).json({ error: 'Source required' });
    }

    if (!Number.isInteger(Number(amount_cents)) || Number(amount_cents) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await transferToMainWallet({
      userId,
      amountCents: Number(amount_cents),
      source
    });

    return res.json({
      transferred: result.transferred_cents
    });

  } catch (err) {
    console.error('Transfer error:', err);
    return res.status(400).json({
      error: err.message || 'Transfer failed'
    });
  }
}

module.exports = { transferProfits };
