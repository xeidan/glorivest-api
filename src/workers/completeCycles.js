'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM trading_cycles
      WHERE status = 'RUNNING'
        AND completes_at <= NOW()
      FOR UPDATE SKIP LOCKED
      `
    );

    for (const c of cycles) {
      const payout =
        Number(c.capital_cents) +
        (c.stopped_early ? 0 : Number(c.expected_profit_cents));

      // 1️⃣ Credit wallet ONCE
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE user_id = $2
          AND type = $3
        `,
        [payout, c.user_id, c.wallet_type]
      );

      // 2️⃣ Mark completed
      await client.query(
        `
        UPDATE trading_cycles
        SET status = 'COMPLETED',
            profit_cents = $1,
            completed_at = NOW()
        WHERE id = $2
        `,
        [
          c.stopped_early ? 0 : c.expected_profit_cents,
          c.id
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('completeExpiredCycles failed:', err);
  } finally {
    client.release();
  }
}

module.exports = { completeExpiredCycles };

