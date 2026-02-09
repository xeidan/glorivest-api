'use strict';

console.log('🔥 marketReplayGenerator loaded');

const { pool } = require('../config/database');

const MAX_POSITIONS_PER_DAY = 7;
const RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h

// This table MUST be populated by frontend WS snapshots
// symbol | price | recorded_at
// e.g. BTCUSDT | 51234.12 | now()

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

      // daily cap
      const { rows: [{ count }] } = await client.query(
        `
        SELECT COUNT(*)::int
        FROM positions
        WHERE cycle_id = $1
          AND source = 'SIMULATION'
          AND opened_at >= date_trunc('day', NOW())
        `,
        [cycle.id]
      );

      if (count >= MAX_POSITIONS_PER_DAY) continue;

      // pick a random recent market snapshot
      const { rows: prices } = await client.query(`
        SELECT symbol, price
        FROM market_prices
        WHERE recorded_at >= NOW() - INTERVAL '1 hour'
        ORDER BY RANDOM()
        LIMIT 1
      `);

      if (!prices.length) continue;

      const { symbol, price } = prices[0];
      const side = Math.random() < 0.5 ? 'LONG' : 'SHORT';

      const openedAt = new Date();
      const delayMinutes = 30 + Math.floor(Math.random() * 90);
      const closedAt = new Date(openedAt.getTime() + delayMinutes * 60 * 1000);

      // small synthetic move (±0.2–0.8%)
      const movePct = (Math.random() * 0.006 + 0.002);
      const direction = side === 'LONG' ? 1 : -1;
      const exitPrice = price * (1 + direction * movePct);

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
          price,
          Number(exitPrice.toFixed(5)),
          openedAt,
          closedAt
        ]
      );
    }

  } catch (err) {
    console.error('❌ marketReplayGenerator error:', err);
  } finally {
    client.release();
  }
}

setInterval(runMarketReplay, RUN_INTERVAL_MS);
runMarketReplay().catch(console.error);

module.exports = { runMarketReplay };
