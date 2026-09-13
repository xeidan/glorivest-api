'use strict';

const { pool } = require('../config/database');

const MIN_INTERVAL_MS = 5_000;
const MAX_REASONABLE_PRICES = {
  BTCUSDT: [20000, 200000],
  ETHUSDT: [500, 20000],
  XAUUSD: [1000, 10000],
  EURUSD: [0.5, 2]
};

/* ======================================================
   RECORD MARKET SNAPSHOT
====================================================== */

async function recordMarketSnapshot(req, res) {
  try {
    const { symbol, price, source = 'external' } = req.body;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({
        message: 'Invalid or missing symbol'
      });
    }

    const normalizedSymbol = symbol.toUpperCase();

    if (typeof price !== 'number' || !Number.isFinite(price)) {
      return res.status(400).json({
        message: 'Invalid price'
      });
    }

    if (!MAX_REASONABLE_PRICES[normalizedSymbol]) {
      return res.status(400).json({
        message: `Unsupported symbol ${normalizedSymbol}`
      });
    }

    const [min, max] = MAX_REASONABLE_PRICES[normalizedSymbol];

    if (price < min || price > max) {
      return res.status(400).json({
        message: `Price ${price} outside sane range for ${normalizedSymbol}`
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
      [normalizedSymbol]
    );

    if (rows.length) {
      const lastTs = new Date(rows[0].recorded_at).getTime();

      if (Date.now() - lastTs < MIN_INTERVAL_MS) {
        return res.json({
          ok: true,
          skipped: true
        });
      }
    }

    /* ---------------- INSERT ---------------- */

    await pool.query(
      `
      INSERT INTO market_prices (symbol, price, source)
      VALUES ($1, $2, $3)
      `,
      [normalizedSymbol, price, source]
    );

    return res.json({
      ok: true
    });

  } catch (err) {
    console.error('❌ recordMarketSnapshot error:', err);

    return res.status(500).json({
      message: 'Snapshot failed'
    });
  }
}

/* ======================================================
   GET MARKET CANDLES
====================================================== */

async function getMarketCandles(req, res) {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase();
    const interval = String(req.query.interval || '1min').toLowerCase();

    const limit = Math.min(
      Math.max(
        Number.parseInt(req.query.limit || '100', 10),
        1
      ),
      500
    );

    if (!MAX_REASONABLE_PRICES[symbol]) {
      return res.status(400).json({
        message: `Unsupported symbol ${symbol}`
      });
    }

    if (interval !== '1min') {
      return res.status(400).json({
        message: `Unsupported interval ${interval}`
      });
    }

    /*
     * Get recent market snapshots.
     */
    const { rows } = await pool.query(
      `
      SELECT recorded_at, price
      FROM market_prices
      WHERE symbol = $1
      ORDER BY recorded_at DESC
      LIMIT $2
      `,
      [symbol, limit * 10]
    );

    /*
     * Convert snapshots into 1-minute OHLC candles.
     */
    const candles = new Map();

    for (const row of rows) {
      const timestamp = new Date(row.recorded_at).getTime();
      const price = Number(row.price);

      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
        continue;
      }

      const minuteTimestamp =
        Math.floor(timestamp / 60000) * 60000;

      const key = minuteTimestamp;

      if (!candles.has(key)) {
        candles.set(key, {
          time: Math.floor(minuteTimestamp / 1000),
          open: price,
          high: price,
          low: price,
          close: price
        });
      } else {
        const candle = candles.get(key);

        candle.open = price;
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
      }
    }

    const result = Array.from(candles.values())
      .sort((a, b) => a.time - b.time)
      .slice(-limit);

    return res.json({
      symbol,
      interval,
      candles: result
    });

  } catch (err) {
    console.error('❌ getMarketCandles error:', err);

    return res.status(500).json({
      message: 'Failed to load market candles'
    });
  }
}

/* ======================================================
   EXPORTS
====================================================== */

module.exports = {
  recordMarketSnapshot,
  getMarketCandles
};