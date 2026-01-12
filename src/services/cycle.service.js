// src/services/cycle.service.js
'use strict';

const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');

async function forfeitCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [cycle.capital_amount, cycle.wallet_id]
    );

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
      throw { statusCode: 404, message: 'Wallet not found' };
    }

    const wallet = walletRes.rows[0];
    requireLiveAccount(wallet);

    if (Number(wallet.balance_cents) < Number(capitalAmount)) {
      throw { statusCode: 400, message: 'Insufficient wallet balance' };
    }

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

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

