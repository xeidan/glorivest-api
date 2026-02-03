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
        NOW() + ($6 * INTERVAL '1 month'),
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
        durationMonths
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
// STOP CYCLE
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
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

    if (!res.rows.length) {
      throw new Error('Active cycle not found');
    }

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

module.exports = {
  startCycle,
  stopCycle
};
