'use strict';

const { pool } = require('../config/database');

const MIN_INTERVAL_MS = 5_000;          // anti-spam
const MAX_PRICE_AGE_MS = 60_000;        // reject stale data
const MAX_REASONABLE_PRICES = {
  BTCUSDT: [20000, 200000],
  ETHUSDT: [500, 20000],
  XAUUSD:  [1000, 10000],
  EURUSD:  [0.5, 2]
};

async function recordMarketSnapshot(req, res) {
  try {
    const { symbol, price, source = 'external' } = req.body;

    /* ---------------- VALIDATION ---------------- */

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ message: 'Invalid or missing symbol' });
    }

    if (typeof price !== 'number' || !Number.isFinite(price)) {
      return res.status(400).json({ message: 'Invalid price' });
    }

    if (!MAX_REASONABLE_PRICES[symbol]) {
      return res.status(400).json({ message: `Unsupported symbol ${symbol}` });
    }

    const [min, max] = MAX_REASONABLE_PRICES[symbol];
    if (price < min || price > max) {
      return res.status(400).json({
        message: `Price ${price} outside sane range for ${symbol}`
      });
    }

    /* ---------------- RATE LIMIT ---------------- */

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
      const lastTs = new Date(rows[0].recorded_at).getTime();
      if (Date.now() - lastTs < MIN_INTERVAL_MS) {
        return res.json({ ok: true, skipped: true });
      }
    }

    /* ---------------- INSERT ---------------- */

    await pool.query(
      `
      INSERT INTO market_prices (symbol, price, source)
      VALUES ($1, $2, $3)
      `,
      [symbol, price, source]
    );

    return res.json({ ok: true });

  } catch (err) {
    console.error('❌ recordMarketSnapshot error:', err);
    return res.status(500).json({ message: 'Snapshot failed' });
  }
}

module.exports = { recordMarketSnapshot };
