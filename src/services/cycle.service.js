'use strict';

const { pool } = require('../config/database');

async function settleCompletedCycles() {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

      // 1️⃣ Calculate real PnL from CLOSED trades only
      const pnlRes = await client.query(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN side = 'LONG'
              THEN (exit_price - entry_price) * size
            WHEN side = 'SHORT'
              THEN (entry_price - exit_price) * size
            ELSE 0
          END
        ),0) AS total_pnl
        FROM positions
        WHERE cycle_id = $1
          AND status = 'CLOSED'
        `,
        [cycle.id]
      );

      const totalPnl = Number(pnlRes.rows[0].total_pnl);
      const pnlCents = Math.round(totalPnl * 100);

      const totalReturnCents =
        Number(cycle.capital_cents) + pnlCents;

      // 2️⃣ Lock wallet to calculate new balance safely
      const walletRes = await client.query(
        `
        SELECT balance_cents
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [cycle.wallet_id]
      );

      if (!walletRes.rows.length) {
        throw new Error('Wallet not found during cycle settlement');
      }

      const currentBalance = Number(walletRes.rows[0].balance_cents);
      const newBalance = currentBalance + totalReturnCents;

      // 3️⃣ Update wallet balance
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [newBalance, cycle.wallet_id]
      );

      // 4️⃣ Store realized profit + mark cycle completed
      await client.query(
        `
        UPDATE cycles
        SET status = 'COMPLETED',
            completed_at = NOW(),
            realized_profit_cents = $1
        WHERE id = $2
        `,
        [pnlCents, cycle.id]
      );

      // 5️⃣ Insert ledger entry with required balance_after_cents
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason, balance_after_cents, cycle_id)
        VALUES ($1, $2, 'CYCLE_SETTLEMENT', $3, $4)
        `,
        [
          cycle.wallet_id,
          totalReturnCents,
          newBalance,
          cycle.id
        ]
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