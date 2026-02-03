'use strict';

const { pool } = require('../config/database');

// --------------------------------------------------
// START CYCLE
// --------------------------------------------------
async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,   // frontend sends this
  durationMonths
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock wallet
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

    // Debit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    // Convert frontend "expectedProfit" to RETURN %
    // expectedProfit is in cents
    // return % = profit / capital * 100
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
        NOW() + ($6 || ' months')::interval,
        'RUNNING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        'STANDARD',          // minimal default tier
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
// STOP CYCLE (FORFEIT)
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const cycleRes = await client.query(
      `
      SELECT c.*, w.id AS wallet_id
      FROM cycles c
      JOIN wallets w ON w.id = c.wallet_id
      WHERE c.id = $1
        AND c.user_id = $2
        AND c.status = 'RUNNING'
      FOR UPDATE
      `,
      [cycleId, userId]
    );

    if (!cycleRes.rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = cycleRes.rows[0];

    // OPTIONAL: partial refund (50%)
    const refund = Math.floor(cycle.capital_cents * 0.5);

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [refund, cycle.wallet_id]
    );

    const { rows } = await client.query(
      `
      UPDATE cycles
      SET
        status = 'CANCELLED',
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
