// src/services/cycle.service.js
'use strict';

const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');

/**
 * =========================
 * FORFEIT CYCLE (5.5.3)
 * =========================
 * - Return ONLY capital
 * - No profit
 * - Ledger first, wallet second
 */
async function forfeitCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Lock cycle
    const cycleRes = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE id = $1
        AND user_id = $2
        AND status = 'active'
      FOR UPDATE
      `,
      [cycleId, userId]
    );

    if (!cycleRes.rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = cycleRes.rows[0];

    // 2️⃣ Ledger refund (capital only)
    await client.query(
      `
      INSERT INTO ledger_entries
        (user_id, wallet_id, type, amount_cents, reference_id)
      VALUES ($1, $2, 'cycle_refund', $3, $4)
      `,
      [
        userId,
        cycle.wallet_id,
        Number(cycle.capital_amount),
        cycle.id
      ]
    );

    // 3️⃣ Wallet cache update
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [cycle.capital_amount, cycle.wallet_id]
    );

    // 4️⃣ Mark cycle forfeited
    const updateRes = await client.query(
      `
      UPDATE investment_cycles
      SET
        status = 'forfeited',
        accrued_profit = 0,
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [cycle.id]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * =========================
 * START CYCLE (5.5.2)
 * =========================
 * - Idempotent
 * - Locks wallet
 * - Ledger records capital lock
 */
async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,
  idempotencyKey
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Idempotency check
    const idem = await client.query(
      `
      SELECT response
      FROM idempotency_keys
      WHERE user_id = $1
        AND key = $2
        AND endpoint = 'cycle_start'
      `,
      [userId, idempotencyKey]
    );

    if (idem.rowCount > 0) {
      await client.query('ROLLBACK');
      return idem.rows[0].response;
    }

    // 2️⃣ Lock wallet
    const walletRes = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!walletRes.rows.length) {
      throw { statusCode: 404, message: 'Wallet not found' };
    }

    const wallet = walletRes.rows[0];
    requireLiveAccount(wallet);

    if (Number(wallet.balance_cents) < Number(capitalAmount)) {
      throw { statusCode: 400, message: 'Insufficient wallet balance' };
    }

    // 3️⃣ Create cycle
    const cycleRes = await client.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, capital_amount, start_at, end_at, expected_profit, status)
      VALUES
        ($1, $2, $3, now(), now() + interval '30 days', $4, 'active')
      RETURNING *
      `,
      [userId, walletId, capitalAmount, expectedProfit]
    );

    const cycle = cycleRes.rows[0];

    // 4️⃣ Ledger lock
    await client.query(
      `
      INSERT INTO ledger_entries
        (user_id, wallet_id, type, amount_cents, reference_id)
      VALUES ($1, $2, 'cycle_lock', $3, $4)
      `,
      [
        userId,
        walletId,
        -Number(capitalAmount),
        cycle.id
      ]
    );

    // 5️⃣ Wallet cache update
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    // 6️⃣ Save idempotency result
    await client.query(
      `
      INSERT INTO idempotency_keys
        (user_id, key, endpoint, response)
      VALUES ($1, $2, 'cycle_start', $3)
      `,
      [userId, idempotencyKey, cycle]
    );

    await client.query('COMMIT');
    return cycle;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  startCycle,
  forfeitCycle
};
