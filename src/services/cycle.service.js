'use strict';

const { pool } = require('../config/database');

/**
 * Settle cycles that have ended.
 * Single source of truth: positions table.

 */
async function settleCompletedCycles() {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock running cycles that have expired
    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE status = 'RUNNING'
        AND ends_at <= NOW()
      FOR UPDATE
      `
    );

    for (const cycle of cycles) {

      // Calculate REAL PnL from positions
      const { rows } = await client.query(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN side IN ('LONG','BUY')
              THEN (exit_price - entry_price) * size
            WHEN side IN ('SHORT','SELL')
              THEN (entry_price - exit_price) * size
            ELSE 0
          END
        ),0) AS total_profit
        FROM positions
        WHERE cycle_id = $1
        `,
        [cycle.id]
      );

      const totalProfit = Number(rows[0].total_profit);

      const totalReturnCents =
        cycle.capital_cents + Math.round(totalProfit * 100);

      // Lock wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [totalReturnCents, cycle.wallet_id]
      );

      // Complete cycle
      await client.query(
        `
        UPDATE cycles
        SET status = 'COMPLETED',
            completed_at = NOW()
        WHERE id = $1
        `,
        [cycle.id]
      );
    }

    await client.query('COMMIT');
    return cycles.length;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  settleCompletedCycles
};
