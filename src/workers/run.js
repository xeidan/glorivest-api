'use strict';

const { pool } = require('../config/database');

async function settleCompletedCycles() {
  const client = await pool.connect();

  try {
    const cyclesRes = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE status = 'completed'
        AND settled = false
      `
    );

    if (!cyclesRes.rowCount) return 0;

    for (const cycle of cyclesRes.rows) {

      const totalReturn =
        Number(cycle.capital_amount) +
        Number(cycle.accrued_profit);

      // Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [totalReturn, cycle.wallet_id]
      );

      // Mark settled
      await client.query(
        `
        UPDATE investment_cycles
        SET settled = true,
            updated_at = NOW()
        WHERE id = $1
        `,
        [cycle.id]
      );
    }

    return cyclesRes.rowCount;

  } finally {
    client.release();
  }
}


if (process.env.ENABLE_WORKER !== 'true') {
  console.log('[worker] disabled');
  process.exit(0);
}

const { settleCompletedCycles } =
  require('../controllers/cycle.controller');

const tradeWorker = require('./trade.worker');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {

  console.log('[worker] main worker started');

  // 🔥 Start trade worker in background
  if (process.env.ENABLE_TRADE_WORKER === 'true') {
    tradeWorker.start();
  }

  // Existing cycle settlement loop
while (true) {
  try {
    await generateTradesForActiveCycles(); // if you have this
    const settled = await settleCompletedCycles();

    if (settled > 0) {
      console.log(`[worker] settled ${settled} cycle(s)`);
    }

  } catch (e) {
    console.error('[worker] error', e);
  }

  await sleep(60_000);
}


})();
