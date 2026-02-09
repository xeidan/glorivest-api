'use strict';

const { pool } = require('../config/database');
const { runCycleSimulation } =
  require('../services/strategyEngine/applyStrategy');

// --------------------------------------------------
// START CYCLE
// --------------------------------------------------

async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,
  durationMonths
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletRes = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!walletRes.rows.length) {
      throw new Error('Wallet not found');
    }

    const wallet = walletRes.rows[0];

    if (wallet.balance_cents < capitalAmount) {
      throw new Error('Insufficient balance');
    }

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    const expectedReturnPct =
      capitalAmount > 0
        ? (Number(expectedProfit) / Number(capitalAmount)) * 100
        : 0;

    // 🔒 FIXED DAYS — NO CALENDAR MONTHS
    const DAYS_PER_MONTH = 30;
    const totalDays = Number(durationMonths) * DAYS_PER_MONTH;

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        user_id,
        wallet_id,
        tier,
        capital_cents,
        expected_return_pct,
        duration_months,
        started_at,
        ends_at,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        NOW(),
        NOW() + ($7 || ' days')::interval,
        'RUNNING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        'STANDARD',
        capitalAmount,
        expectedReturnPct,
        durationMonths, // kept for reference
        totalDays       // 👈 THIS is what ends_at uses
      ]
    );

    await client.query('COMMIT');
    return rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


// --------------------------------------------------
// STOP CYCLE (FORFEIT → REFUND CAPITAL ONLY)
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock cycle
    const cycleRes = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE id = $1
        AND user_id = $2
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [cycleId, userId]
    );

    if (!cycleRes.rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = cycleRes.rows[0];

    // DEMO cycles do NOT affect wallets
    const isDemo = cycle.wallet_type === 'DEMO';

    // 2. Lock wallet (LIVE only)
    let wallet;
    if (!isDemo) {
      const walletRes = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [cycle.wallet_id]
      );

      if (!walletRes.rows.length) {
        throw new Error('Wallet not found');
      }

      wallet = walletRes.rows[0];

      // 3. Refund capital
      const newBalance = wallet.balance_cents + cycle.capital_cents;

      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1
        WHERE id = $2
        `,
        [newBalance, wallet.id]
      );

      // 4. Ledger entry
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, cycle_id, type, reason, amount_cents, balance_after_cents)
        VALUES
          ($1, $2, 'CREDIT', 'CYCLE_FORFEIT_REFUND', $3, $4)
        `,
        [
          wallet.id,
          cycle.id,
          cycle.capital_cents,
          newBalance
        ]
      );
    }

    // 5. Cancel cycle
    const { rows } = await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED',
          completed_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [cycle.id]
    );

    await client.query('COMMIT');
    return rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}




// --------------------------------------------------
// SETTLE COMPLETED CYCLES (CRON, IDEMPOTENT, SAFE)
// --------------------------------------------------

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

      // Idempotency guard
      const { rows: already } = await client.query(
        `
        SELECT 1
        FROM wallet_ledger
        WHERE cycle_id = $1
          AND reason = 'POSITION_PNL'
        LIMIT 1
        `,
        [cycle.id]
      );

      if (already.length) {
        await client.query(
          `
          UPDATE cycles
          SET status = 'COMPLETED',
              completed_at = NOW()
          WHERE id = $1
          `,
          [cycle.id]
        );
        continue;
      }

      const { rows: wallets } = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [cycle.wallet_id]
      );

      if (!wallets.length) {
        await client.query(
          `
          UPDATE cycles
          SET status = 'CANCELLED',
              completed_at = NOW()
          WHERE id = $1
          `,
          [cycle.id]
        );
        continue;
      }

      const wallet = wallets[0];



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
  startCycle,
  stopCycle,
  settleCompletedCycles
};
