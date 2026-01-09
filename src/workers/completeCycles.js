'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const cycles = await client.query(`
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
        AND now() >= end_at
      FOR UPDATE
    `);

    for (const cycle of cycles.rows) {
      // 1️⃣ Mark cycle completed
      await client.query(
        `
        UPDATE investment_cycles
        SET
          accrued_profit = expected_profit,
          status = 'completed',
          updated_at = now()
        WHERE id = $1
        `,
        [cycle.id]
      );

      // 2️⃣ Credit wallet (principal + profit)
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [
          Math.round(Number(cycle.expected_profit) * 100),
          cycle.wallet_id
        ]
      );
    }

    await client.query('COMMIT');

    if (cycles.rowCount > 0) {
      console.log(`✅ Completed ${cycles.rowCount} cycles`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('completeExpiredCycles error', err);
  } finally {
    client.release();
  }
}

setInterval(completeExpiredCycles, 60 * 1000); // every 1 min

module.exports = { completeExpiredCycles };
