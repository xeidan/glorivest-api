'use strict';

const { pool } = require('../config/database');

/**
 * Trading simulation worker
 * ✅ Does NOT touch wallets
 * ✅ Does NOT complete cycles
 * ✅ Cosmetic positions only
 */
async function runTradingWorker() {
  const client = await pool.connect();

  try {
    const { rows: cycles } = await client.query(
      `
      SELECT id, user_id, capital_cents
      FROM trading_cycles
      WHERE status = 'RUNNING'
        AND stopped_early = false
        AND completes_at > NOW()
      `
    );

    for (const cycle of cycles) {
      await maybeOpenPosition(client, cycle);
    }

  } catch (err) {
    console.error('[TRADING WORKER] error:', err);
  } finally {
    client.release();
  }
}

/**
 * Random cosmetic bot positions
 */
async function maybeOpenPosition(client, cycle) {
  if (Math.random() > 0.2) return;

  const capitalCents = Number(cycle.capital_cents);
  if (capitalCents <= 0) return;

  const symbol = 'VIX75';
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const entryPrice = Number((1000 + Math.random() * 50).toFixed(2));
  const volume = Number(((capitalCents / 100) / entryPrice).toFixed(4));

  if (volume <= 0) return;

  await client.query(
    `
    INSERT INTO bot_positions (
      user_id,
      trading_cycle_id,
      symbol,
      side,
      volume,
      entry_price,
      status,
      opened_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,'OPEN',NOW())
    `,
    [
      cycle.user_id,
      cycle.id,
      symbol,
      side,
      volume,
      entryPrice
    ]
  );
}

module.exports = { runTradingWorker };
