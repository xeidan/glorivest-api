// src/controllers/withdrawal.controller.js
'use strict';

const withdrawalService = require('../services/withdrawal.service');

exports.requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount_usd, address } = req.body;

    const r = await withdrawalService.createWithdrawalRequest(
      userId,
      amount_usd,
      address
    );

    return res.json(r);
  } catch (err) {
    console.error('requestWithdrawal error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.myWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;
    const list = await withdrawalService.listWithdrawals(userId);
    return res.json(list);
  } catch (err) {
    console.error('myWithdrawals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
