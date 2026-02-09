'use strict';

const { pool } = require('../config/database');

async function recordMarketSnapshot(req, res) {
  const { symbol, price } = req.body;

  if (!symbol || typeof price !== 'number') {
    return res.status(400).json({ message: 'Invalid payload' });
  }

  try {
    await pool.query(
      `
      INSERT INTO market_prices (symbol, price)
      VALUES ($1, $2)
      `,
      [symbol, price]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('market snapshot error:', err);
    res.status(500).json({ message: 'Failed to record snapshot' });
  }
}

module.exports = { recordMarketSnapshot };
