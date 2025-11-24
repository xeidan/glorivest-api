// src/controllers/deposit.controller.js
'use strict';

const { pool } = require('../config/database');
const depositService = require('../services/deposit.service');

exports.createDepositReference = async (req, res) => {
  try {
    const { id } = req.user;
    const { amount_usd } = req.body;

    const ref = await depositService.generateDepositReference(id, amount_usd);

    return res.json(ref);
  } catch (err) {
    console.error('createDepositReference error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.checkDeposits = async (req, res) => {
  try {
    const { id } = req.user;
    const list = await depositService.getUserDeposits(id);
    return res.json(list);
  } catch (err) {
    console.error('checkDeposits error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
