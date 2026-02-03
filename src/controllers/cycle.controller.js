'use strict';

const { pool } = require('../config/database');

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
// STOP CYCLE (REFUND CAPITAL)
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

    // 2. Lock wallet
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

    // 3. Refund capital
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [cycle.capital_cents, cycle.wallet_id]
    );

    // 4. Cancel cycle
    const { rows } = await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED',
          completed_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [cycleId]
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
// SETTLE COMPLETED CYCLES
// --------------------------------------------------
async function settleCompletedCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock all expired running cycles
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
      // 2. Lock wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [
          cycle.capital_cents +
            Math.floor(
              cycle.capital_cents * (cycle.expected_return_pct / 100)
            ),
          cycle.wallet_id
        ]
      );

      // 3. Mark cycle completed
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
