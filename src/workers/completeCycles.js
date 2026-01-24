'use strict';

const { pool } = require('../config/database');

/**
 * COMPLETE EXPIRED TRADING CYCLES
 *
 * Responsibilities:
 * - Find RUNNING cycles past completes_at
 * - Lock them
 * - Mark as COMPLETED
 * - Persist profit_cents
 *
 * ❌ DOES NOT:
 * - credit wallets
 * - transfer profit
 * - touch ledger
 *
 * Profit is transferred ONLY via transferTradeProfits controller.
 */
async function completeExpiredCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, expected_profit_cents
      FROM trading_cycles
      WHERE status = 'RUNNING'
        AND completes_at <= NOW()
      FOR UPDATE
      `
    );

    if (rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    for (const cycle of rows) {
      await client.query(
        `
        UPDATE trading_cycles
        SET
          status = 'COMPLETED',
          profit_cents = $1,
          completed_at = NOW()
        WHERE id = $2
          AND status = 'RUNNING'
        `,
        [cycle.expected_profit_cents, cycle.id]
      );
    }

    await client.query('COMMIT');

    console.log(`✅ Completed ${rows.length} trading cycles`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ completeExpiredCycles error:', err);
  } finally {
    client.release();
  }
}

module.exports = { completeExpiredCycles };
