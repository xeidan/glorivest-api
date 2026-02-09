'use strict';

console.log('🔥 marketReplayGenerator loaded');

const { pool } = require('../config/database');

const MAX_POSITIONS_PER_DAY = 7;
const SYMBOL_COOLDOWN_HOURS = 6;
const RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ===============================
// HELPERS
// ===============================

function pickSide() {
  return Math.random() < 0.5 ? 'LONG' : 'SHORT';
}

// ===============================
// CORE
// ===============================

async function runMarketReplay() {
  console.log('▶ marketReplayGenerator tick');

  const client = await pool.connect();

  try {
    // 1️⃣ get running cycles
    const { rows: cycles } = await client.query(`
      SELECT id, user_id, wallet_id
      FROM cycles
      WHERE status = 'RUNNING'
    `);

    if (!cycles.length) return;

    for (const cycle of cycles) {

      // 2️⃣ daily cap per cycle
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

      // 3️⃣ pick an ENTRY snapshot (real price)
      const { rows: entryRows } = await client.query(`
        SELECT symbol, price, recorded_at
        FROM market_prices
        WHERE recorded_at >= NOW() - INTERVAL '2 hours'
        ORDER BY recorded_at ASC
        LIMIT 1
      `);

      if (!entryRows.length) continue;

      const entry = entryRows[0];

      // 4️⃣ symbol cooldown (anti-spam)
      const { rows: recent } = await client.query(
        `
        SELECT 1
        FROM positions
        WHERE cycle_id = $1
          AND symbol = $2
          AND opened_at >= NOW() - ($3 || ' hours')::interval
        LIMIT 1
        `,
        [cycle.id, entry.symbol, SYMBOL_COOLDOWN_HOURS]
      );

      if (recent.length) continue;

      // 5️⃣ find EXIT snapshot after entry (real movement)
      const { rows: exitRows } = await client.query(
        `
        SELECT price, recorded_at
        FROM market_prices
        WHERE symbol = $1
          AND recorded_at > $2
        ORDER BY recorded_at ASC
        LIMIT 1
        `,
        [entry.symbol, entry.recorded_at]
      );

      if (!exitRows.length) continue;

      const exit = exitRows[0];

      // 6️⃣ timestamps
      const openedAt = new Date(entry.recorded_at);
      const closedAt = new Date(exit.recorded_at);

      // 7️⃣ insert CLOSED simulated position
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
          entry.symbol,
          pickSide(),
          Number(entry.price),
          Number(exit.price),
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

// ===============================
// SCHEDULING
// ===============================

setInterval(runMarketReplay, RUN_INTERVAL_MS);

// boot run
runMarketReplay().catch(console.error);

module.exports = { runMarketReplay };
