'use strict';

const { pool } = require('../config/database');

const MIN_INTERVAL_MS = 5000; // 5 seconds per symbol

async function recordMarketSnapshot(req, res) {
  try {
    const { symbol, price } = req.body;

    if (!symbol || typeof price !== 'number') {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    const { rows } = await pool.query(
      `
      SELECT recorded_at
      FROM market_prices
      WHERE symbol = $1
      ORDER BY recorded_at DESC
      LIMIT 1
      `,
      [symbol]
    );

    if (rows.length) {
      const last = new Date(rows[0].recorded_at).getTime();
      if (Date.now() - last < MIN_INTERVAL_MS) {
        return res.json({ ok: true, skipped: true });
      }
    }

    await pool.query(
      `
      INSERT INTO market_prices (symbol, price)
      VALUES ($1, $2)
      `,
      [symbol, price]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ recordMarketSnapshot error:', err);
    return res.status(500).json({ message: 'Internal error' });
  }
}

module.exports = { recordMarketSnapshot };
