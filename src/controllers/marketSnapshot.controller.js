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

    const intervalSeconds = {
      '1min': 60,
      '5min': 300,
      '15min': 900,
      '30min': 1800,
      '1h': 3600,
      '4h': 14400,
      '1day': 86400,
      '1week': 604800
    };

    const bucketSeconds = intervalSeconds[interval];

    if (!bucketSeconds) {
      return res.status(400).json({
        message: `Unsupported interval ${interval}`
      });
    }

    const { rows } = await pool.query(
      `
      WITH bucketed AS (
        SELECT
          to_timestamp(
            floor(extract(epoch FROM recorded_at) / $2) * $2
          ) AS candle_time,
          price,
          recorded_at
        FROM market_prices
        WHERE symbol = $1
      ),

      candles AS (
        SELECT
          candle_time,

          (
            SELECT b2.price
            FROM bucketed b2
            WHERE b2.candle_time = b1.candle_time
            ORDER BY b2.recorded_at ASC
            LIMIT 1
          ) AS open,

          MAX(price) AS high,
          MIN(price) AS low,

          (
            SELECT b3.price
            FROM bucketed b3
            WHERE b3.candle_time = b1.candle_time
            ORDER BY b3.recorded_at DESC
            LIMIT 1
          ) AS close

        FROM bucketed b1
        GROUP BY candle_time
        ORDER BY candle_time DESC
        LIMIT $3
      )

      SELECT
        EXTRACT(EPOCH FROM candle_time)::BIGINT AS time,
        open,
        high,
        low,
        close
      FROM candles
      ORDER BY candle_time ASC
      `,
      [symbol, bucketSeconds, limit]
    );

    return res.json({
      symbol,
      interval,
      candles: rows.map(row => ({
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close)
      }))
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