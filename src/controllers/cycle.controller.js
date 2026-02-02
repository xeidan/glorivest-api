'use strict';

const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');

// --------------------------------------------------
// START CYCLE (MULTIPLE PER WALLET SUPPORTED)
// --------------------------------------------------
async function startCycle({ userId, walletId, capitalAmount, expectedProfit }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Lock wallet row
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
      throw new Error('Wallet not found or not owned by user');
    }

    const wallet = walletRes.rows[0];
    requireLiveAccount(wallet);

    if (Number(wallet.balance_cents) < Number(capitalAmount)) {
      throw new Error('Insufficient wallet balance');
    }

    // 2️⃣ Deduct capital from wallet
    await client.query(
      `
      INSERT INTO cycles (
        wallet_id,
        capital_amount,
        expected_profit,
        duration_months,
        start_at,
        status
      )
      VALUES ($1, $2, $3, $4, NOW(), 'active')
      `,
      [
        walletId,
        capitalAmount,
        expectedProfit,
        durationMonths // 👈 MUST come from request body
      ]
    );


    // 3️⃣ Create independent investment cycle
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const cycleRes = await client.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, capital_amount, expected_profit, start_at, end_at, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING *
      `,
      [userId, walletId, capitalAmount, expectedProfit, startAt, endAt]
    );

    await client.query('COMMIT');
    return cycleRes.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --------------------------------------------------
// STOP SINGLE CYCLE (FORFEIT)
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
      `
      UPDATE investment_cycles
      SET
        status = 'forfeited',
        accrued_profit = 0,
        updated_at = now()
      WHERE id = $1
        AND user_id = $2
        AND status = 'active'
      RETURNING *
      `,
      [cycleId, userId]
    );

    if (!res.rows.length) {
      throw new Error('Active cycle not found');
    }

    await client.query('COMMIT');
    return res.rows[0];

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
