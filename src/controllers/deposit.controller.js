// src/controllers/deposit.controller.js
'use strict';

const { processSuccessfulDeposit } = require('../services/deposit.service');

async function depositWebhook(req, res) {
  try {
    const { userId, amount_cents } = req.body;

    await processSuccessfulDeposit(userId, amount_cents);

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Deposit processing failed' });
  }
}
