'use strict';

console.log('🔥 marketReplayGenerator loaded');

const { pool } = require('../config/database');
const { getPrice } = require('../services/priceFeed/getPrice');

// =====================================
// CONFIG
// =====================================

const ASSETS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT',
  'XAUUSD','XAGUSD',
  'AAPL','TSLA','MSFT','NVDA',
  'EURUSD','GBPUSD','USDJPY','AUDUSD',
  'USDCAD','USDCHF','NZDUSD','EURJPY'
];

const FALLBACK_SYMBOL = 'BTCUSDT';
const MAX_POSITIONS_PER_DAY = 7;
const RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// =====================================
// HELPERS
// =====================================

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSide() {
  return Math.random() < 0.5 ? 'LONG' : 'SHORT';
}

function shouldCreatePosition() {
  return Math.random() < 0.7; // ~6–7/day
}

// =====================================
// CORE
// =====================================

async function runMarketReplay() {
  console.log('▶ marketReplayGenerator tick');

  const client = await pool.connect();

  try {
    const { rows: cycles } = await client.query(`
      SELECT id, user_id, wallet_id
      FROM cycles
      WHERE status = 'RUNNING'
    `);

    if (!cycles.length) return;

    for (const cycle of cycles) {

      // -------------------------------
      // DAILY CAP (HARD)
      // -------------------------------
      const { rows: [{ count }] } = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM positions
        WHERE cycle_id = $1
          AND source = 'SIMULATION'
          AND opened_at >= date_trunc('day', NOW())
        `,
        [cycle.id]
      );

      if (count >= MAX_POSITIONS_PER_DAY) continue;
      if (!shouldCreatePosition()) continue;

      let symbol = pick(ASSETS);
      const side = pickSide();

      const openedAt = new Date();

      const delayMinutes = 30 + Math.floor(Math.random() * 90);
      const closedAt = new Date(
        openedAt.getTime() + delayMinutes * 60 * 1000
      );

      let entryPrice;
      let exitPrice;

      // -------------------------------
      // PRICE FETCH (FAULT-TOLERANT)
      // -------------------------------
      try {
        entryPrice = await getPrice(symbol);
        exitPrice  = await getPrice(symbol);
      } catch (err) {
        console.error(`⚠️ replay price failed for ${symbol}: ${err.message}`);

        // fallback to BTCUSDT
        try {
          symbol = FALLBACK_SYMBOL;
          entryPrice = await getPrice(symbol);
          exitPrice  = await getPrice(symbol);
        } catch (fallbackErr) {
          console.error(
            `❌ fallback price failed for ${FALLBACK_SYMBOL}: ${fallbackErr.message}`
          );
          continue; // only skip if even BTC fails
        }
      }

      // -------------------------------
      // INSERT (CLOSED ONLY)
      // -------------------------------
      await client.query(
        `
        INSERT INTO positions (
          user_id,
          wallet_id,
          cycle_id,
          symbol,
          side,
          size,
          entry_price,
          exit_price,
          status,
          opened_at,
          closed_at,
          source
        )
        VALUES (
          $1,$2,$3,$4,$5,
          1,$6,$7,
          'CLOSED',$8,$9,'SIMULATION'
        )
        `,
        [
          cycle.user_id,
          cycle.wallet_id,
          cycle.id,
          symbol,
          side,
          entryPrice,
          exitPrice,
          openedAt,
          closedAt
        ]
      );
    }

  } catch (err) {
    console.error('❌ marketReplayGenerator fatal error:', err);
  } finally {
    client.release();
  }
}

// =====================================
// SCHEDULING
// =====================================

// periodic run
setInterval(runMarketReplay, RUN_INTERVAL_MS);

// boot run (no waiting)
runMarketReplay().catch(err =>
  console.error('❌ initial marketReplayGenerator run failed:', err)
);

module.exports = { runMarketReplay };
