'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Lock all expired active cycles
    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
        AND now() >= end_at
      FOR UPDATE
      `
    );

    if (cycles.length === 0) {
      await client.query('COMMIT');
      return;
    }

    // 2️⃣ Process each cycle safely
    for (const cycle of cycles) {
      const capital = Number(cycle.capital_amount);
      const profit = Number(cycle.expected_profit);
      const totalPayout = capital + profit;

      // Credit wallet (capital + profit)
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [totalPayout, cycle.wallet_id]
      );

      // Mark cycle completed (idempotency gate)
      await client.query(
        `
        UPDATE investment_cycles
        SET
          status = 'completed',
          accrued_profit = expected_profit,
          updated_at = now()
        WHERE id = $1
          AND status = 'active'
        `,
        [cycle.id]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Completed ${cycles.length} investment cycles`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ completeExpiredCycles failed:', err);
  } finally {
    client.release();
  }
}

module.exports = { completeExpiredCycles };
