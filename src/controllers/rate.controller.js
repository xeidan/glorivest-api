'use strict';

const Settings = require('../models/settings');

exports.getRate = async (req, res) => {
  try {
    const rate = await Settings.get('USDT_NGN_RATE');

    return res.json({
      rate: Number(rate || 0)
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Failed to fetch rate'
    });
  }
};

exports.updateRate = async (req, res) => {
  try {
    const { rate } = req.body;

    if (!rate || Number(rate) <= 0) {
      return res.status(400).json({
        message: 'Invalid rate'
      });
    }

    await Settings.set('USDT_NGN_RATE', String(rate));

    return res.json({
      message: 'Rate updated'
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Failed to update rate'
    });
  }
};