'use strict';

const { pool } = require('../config/database');
const normalizeDuration = require('../utils/normalizeDuration');

// --------------------------------------------------
// START CYCLE
// --------------------------------------------------
async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,
  durationMonths // frontend MUST send this name
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const duration = normalizeDuration(durationMonths);

    const { rows: walletRows } = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!walletRows.length) {
      throw new Error('Wallet not found');
    }

    const wallet = walletRows[0];

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

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        user_id,
        wallet_id,
        capital_amount,
        expected_profit,
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
        NOW(),
        NOW() + ($5 || ' months')::interval,
        'active'
      )
      RETURNING
        id,
        user_id,
        wallet_id,
        capital,
        expected_profit,
        duration_months,
        started_at,
        ends_at,
        status
      `,
      [
        userId,
        walletId,
        capitalAmount,
        expectedProfit,
        duration
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

    const { rows } = await client.query(
      `
      SELECT c.*, w.id AS wallet_id
      FROM cycles c
      JOIN wallets w ON w.id = c.wallet_id
      WHERE c.id = $1
        AND w.user_id = $2
        AND c.status = 'active'
      FOR UPDATE
      `,
      [cycleId, userId]
    );

    if (!rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = rows[0];

    // OPTIONAL: partial refund logic
    const refund = Math.floor(cycle.capital_amount * 0.5);

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [refund, cycle.wallet_id]
    );

    const { rows: updated } = await client.query(
      `
      UPDATE cycles
      SET
        status = 'forfeited',
        expected_profit = 0,
        ends_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [cycleId]
    );

    await client.query('COMMIT');
    return updated[0];

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
