'use strict';

const { pool } = require('../config/database');

/* ======================================================
   WORKER ENTRY POINT
====================================================== */
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

/* ======================================================
   PROCESS SINGLE CYCLE
====================================================== */
async function processCycle(client, cycle) {
  const nowTs = Date.now();
  const completesAtTs = new Date(cycle.completes_at).getTime();

  if (nowTs >= completesAtTs) {
    await finalizeCycle(client, cycle);
    return;
  }

  // Randomly open positions while running
  if (Math.random() < 0.2) {
    await openPosition(client, cycle);
  }
}

/* ======================================================
   OPEN BOT POSITION
====================================================== */
async function openPosition(client, cycle) {
  const capitalCents = Number(cycle.capital_cents);

  if (!capitalCents || capitalCents <= 0) return;

  const symbol = 'VIX75';
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const entryPrice = Number((1000 + Math.random() * 50).toFixed(2));

  const volume = Number(
    ((capitalCents / 100) / entryPrice).toFixed(4)
  );

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

/* ======================================================
   CLOSE ALL OPEN POSITIONS
====================================================== */
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
    const entry = Number(p.entry_price);
    const volume = Number(p.volume);

    const exitPrice = Number(
      (entry * (0.95 + Math.random() * 0.1)).toFixed(2)
    );

    const pnlCents = Math.floor(
      (exitPrice - entry) * volume * 100
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

/* ======================================================
   FINALIZE CYCLE (ROI-CAPPED PAYOUT)
====================================================== */
async function finalizeCycle(client, cycle) {
  const cycleId = cycle.id;
  const userId = cycle.user_id;

  const capital = Number(cycle.capital_cents);
  const expectedProfit = Number(cycle.expected_profit_cents);

  await client.query('BEGIN');

  try {
    // 1️⃣ Close remaining positions
    await closeOpenPositions(client, cycle);

    // 2️⃣ Compute realized PnL
    const { rows } = await client.query(
      `
      SELECT COALESCE(SUM(pnl_cents),0) AS total
      FROM bot_positions
      WHERE trading_cycle_id = $1
      `,
      [cycleId]
    );

    const realizedProfit = Number(rows[0].total);

    // 3️⃣ Enforce ROI cap
    const finalProfit = Math.min(realizedProfit, expectedProfit);

    // 4️⃣ Credit wallet (capital + capped profit)
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE user_id = $2
        AND type = $3
      `,
      [
        capital + finalProfit,
        userId,
        cycle.wallet_type
      ]
    );

    // 5️⃣ Close cycle
    await client.query(
      `
      UPDATE trading_cycles
      SET status = 'COMPLETED',
          profit_cents = $1,
          completed_at = NOW()
      WHERE id = $2
      `,
      [finalProfit, cycleId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = { runTradingWorker };
