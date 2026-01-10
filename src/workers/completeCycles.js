'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: cycles } = await client.query(`
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
        AND now() >= end_at
      FOR UPDATE
    `);

    for (const cycle of cycles) {
      const payout =
        Number(cycle.capital_amount) +
        Number(cycle.expected_profit);

      // 1️⃣ Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [payout, cycle.wallet_id]
      );

      // 2️⃣ Complete cycle
      await client.query(
        `
        UPDATE investment_cycles
        SET
          status = 'completed',
          accrued_profit = expected_profit,
          updated_at = now()
        WHERE id = $1
        `,
        [cycle.id]
      );
    }

    await client.query('COMMIT');

    if (cycles.length > 0) {
      console.log(`✅ Completed ${cycles.length} cycles`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ completeExpiredCycles failed', err);
  } finally {
    client.release();
  }
}

module.exports = { completeExpiredCycles };
