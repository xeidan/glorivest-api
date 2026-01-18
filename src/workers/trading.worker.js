'use strict';

const { pool } = require('../config/database');

/* ===============================
   WORKER ENTRY POINT
=============================== */
async function runTradingWorker() {
  const client = await pool.connect();

  try {
    const { rows: cycles } = await client.query(`
      SELECT *
      FROM trading_cycles
      WHERE status = 'RUNNING'
        AND stopped_early = false
    `);

    for (const cycle of cycles) {
      await processCycle(client, cycle);
    }
  } catch (err) {
    console.error('[WORKER] Fatal error:', err);
  } finally {
    client.release();
  }
}

/* ===============================
   PROCESS ONE CYCLE
=============================== */
async function processCycle(client, cycle) {
  const now = Date.now();
  const end = new Date(cycle.completes_at).getTime();

  if (now >= end) {
    await finalizeCycle(client, cycle);
    return;
  }

  const shouldOpen = Math.random() < 0.2;
  if (shouldOpen) {
    await openPosition(client, cycle);
  }
}

/* ===============================
   OPEN POSITION
=============================== */
async function openPosition(client, cycle) {
  const symbol = 'VIX75';
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const entryPrice = 1000 + Math.random() * 50;
  const volume = Number(
    (cycle.capital_cents / 100 / entryPrice).toFixed(4)
  );

  await client.query(
    `
    INSERT INTO bot_positions (
      user_id,
      trading_cycle_id,
      symbol,
      side,
      volume,
      entry_price,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,'OPEN')
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

/* ===============================
   CLOSE OPEN POSITIONS
=============================== */
async function closeOpenPositions(client, cycle) {
  const { rows: positions } = await client.query(
    `
    SELECT *
    FROM bot_positions
    WHERE trading_cycle_id = $1
      AND status = 'OPEN'
    `,
    [cycle.id]
  );

  for (const p of positions) {
    const exitPrice = p.entry_price * (0.95 + Math.random() * 0.1);
    const pnlCents = Math.floor(
      (exitPrice - p.entry_price) * p.volume * 100
    );

    await client.query(
      `
      UPDATE bot_positions
      SET status='CLOSED',
          exit_price=$1,
          pnl_cents=$2,
          closed_at=NOW()
      WHERE id=$3
      `,
      [exitPrice, pnlCents, p.id]
    );
  }
}

/* ===============================
   FINALIZE CYCLE (ROI ENFORCED)
=============================== */
async function finalizeCycle(client, cycle) {
  await closeOpenPositions(client, cycle);

  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(pnl_cents),0) AS total
    FROM bot_positions
    WHERE trading_cycle_id = $1
    `,
    [cycle.id]
  );

  const realized = Number(rows[0].total);
  const cappedProfit = Math.min(realized, cycle.expected_profit_cents);

  await client.query('BEGIN');

  try {
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE user_id=$2 AND type=$3
      `,
      [
        cycle.capital_cents + cappedProfit,
        cycle.user_id,
        cycle.wallet_type
      ]
    );

    await client.query(
      `
      UPDATE trading_cycles
      SET status='COMPLETED',
          profit_cents=$1
      WHERE id=$2
      `,
      [cappedProfit, cycle.id]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

module.exports = { runTradingWorker };
