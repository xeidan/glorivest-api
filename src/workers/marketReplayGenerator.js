'use strict';
console.log('🔥 marketReplayGenerator loaded');

const { pool } = require('../config/database');
const { getPrice } = require('../services/priceFeed/getPrice');


const ASSETS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT',
  'XAUUSDT','XAGUSDT',
  'AAPL','TSLA','MSFT','NVDA',
  'EURUSD','GBPUSD','USDJPY','AUDUSD',
  'USDCAD','USDCHF','NZDUSD','EURJPY'
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSide() {
  return Math.random() < 0.5 ? 'LONG' : 'SHORT';
}

// guard so we don’t spam positions
function shouldCreatePosition() {
  return Math.random() < 0.7; // ~6–7/day with 4h interval
}

async function runMarketReplay() {
    console.log('▶ marketReplayGenerator tick');

  const client = await pool.connect();

  try {
    const { rows: cycles } = await client.query(`
      SELECT c.id, c.user_id, c.wallet_id
      FROM cycles c
      WHERE c.status = 'RUNNING'
    `);

    if (!cycles.length) return;

    for (const cycle of cycles) {
      if (!shouldCreatePosition()) continue;

      const symbol = pick(ASSETS);
      const side = pickSide();

      const openedAt = new Date();
      const entryPrice = await getPrice(symbol);

      // simple delay simulation (30–120 mins)
      const delayMinutes = 30 + Math.floor(Math.random() * 90);
      const closedAt = new Date(
        openedAt.getTime() + delayMinutes * 60 * 1000
      );

      const exitPrice  = await getPrice(symbol);

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
          $6,$7,$8,
          'CLOSED',$9,$10,'SIMULATION'
        )
        `,
        [
          cycle.user_id,
          cycle.wallet_id,
          cycle.id,
          symbol,
          side,
          1,                // size is cosmetic
          entryPrice,
          exitPrice,
          openedAt,
          closedAt
        ]
      );
    }

  } catch (err) {
    console.error('marketReplayGenerator error:', err);
  } finally {
    client.release();
  }
}

// run every 4 hours
setInterval(runMarketReplay, 4 * 60 * 60 * 1000);

// optional boot run
runMarketReplay().catch(console.error);

module.exports = { runMarketReplay };
