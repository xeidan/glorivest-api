'use strict';

const { pool, withTx } = require('../config/database');

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

async function startCycle({ userId, walletId, expectedProfit }) {
  return withTx(async (client) => {

    const walletRes = await client.query(
      `SELECT id FROM wallets WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );

    if (walletRes.rowCount === 0) {
      throw new Error('Wallet not found or not owned by user');
    }

    const activeRes = await client.query(
      `SELECT id FROM investment_cycles
       WHERE wallet_id = $1 AND status = 'active'`,
      [walletId]
    );

    if (activeRes.rowCount > 0) {
      throw new Error('Active investment cycle already exists');
    }

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + DAYS_30_MS);

    const insertRes = await client.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, start_at, end_at, expected_profit, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
      `,
      [userId, walletId, startAt, endAt, expectedProfit]
    );

    return insertRes.rows[0];
  });
}

async function stopCycle({ userId, walletId }) {
  const res = await pool.query(
    `
    UPDATE investment_cycles
    SET status = 'forfeited',
        accrued_profit = 0,
        updated_at = now()
    WHERE wallet_id = $1
      AND user_id = $2
      AND status = 'active'
    RETURNING *
    `,
    [walletId, userId]
  );

  if (res.rowCount === 0) {
    throw new Error('No active cycle to stop');
  }

  return res.rows[0];
}

module.exports = {
  startCycle,
  stopCycle,
};
