// src/services/cycle.service.js
'use strict';

const { pool } = require('../config/database');

async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Lock the cycle row
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

    // 2️⃣ Return ONLY capital (no profit)
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [cycle.capital_amount, cycle.wallet_id]
    );

    // 3️⃣ Mark cycle forfeited
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

module.exports = { stopCycle };
