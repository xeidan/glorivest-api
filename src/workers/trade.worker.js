'use strict';

const { pool } = require('../config/database');

const {
  generateTradesForCycle
} = require('../services/performanceEngine.service');

const cycleService = require('../services/cycle.service');

const INTERVAL = Number(
  process.env.TRADE_WORKER_INTERVAL_MS || 5000
);

/* ======================================================
   SIMULATED MARKET PRICES
====================================================== */

const MARKET_PRICES = {
  BTCUSDT: 112000,
  ETHUSDT: 4300,
  XAUUSD: 3650,
  EURUSD: 1.17
};

const PRICE_VOLATILITY = {
  BTCUSDT: 0.0008,
  ETHUSDT: 0.001,
  XAUUSD: 0.0004,
  EURUSD: 0.0002
};

function randomMove() {
  return Math.random() * 2 - 1;
}

async function recordMarketSnapshots() {
  for (const symbol of Object.keys(MARKET_PRICES)) {
    const basePrice = MARKET_PRICES[symbol];
    const volatility = PRICE_VOLATILITY[symbol];

    const movement = randomMove() * volatility;
    const price = basePrice * (1 + movement);

    MARKET_PRICES[symbol] = price;

    try {
      await pool.query(
        `
        INSERT INTO market_prices (
          symbol,
          price,
          source
        )
        VALUES ($1, $2, $3)
        `,
        [symbol, price, 'MOCK_MARKET']
      );
    } catch (err) {
      console.error(
        `Market snapshot failed for ${symbol}:`,
        err.message
      );
    }
  }
}

/* ======================================================
   WORKER
====================================================== */

async function runOnce() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE status = 'RUNNING'
      ORDER BY started_at ASC
      FOR UPDATE SKIP LOCKED
      `
    );

    await client.query('COMMIT');

    /*
     * Generate simulated market data.
     */
    await recordMarketSnapshots();

    /*
     * Generate mock positions for running cycles.
     */
    for (const cycle of cycles) {
      try {
        await generateTradesForCycle(cycle);
      } catch (err) {
        console.error(
          `Trade generation failed for cycle ${cycle.id}:`,
          err.message
        );
      }
    }

    /*
     * Settle completed cycles.
     */
    await cycleService.settleCompletedCycles();

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error('Trade Worker Error:', err);
  } finally {
    client.release();
  }
}

async function start() {
  console.log('🚀 Trade Worker Started');

  while (true) {
    await runOnce();

    await new Promise(resolve =>
      setTimeout(resolve, INTERVAL)
    );
  }
}

module.exports = {
  start,
  runOnce
};