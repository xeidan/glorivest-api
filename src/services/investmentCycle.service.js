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


async function getCurrentCycle({ userId, walletId }) {
  const res = await pool.query(
    `
    SELECT
      id,
      user_id,
      wallet_id,
      start_at,
      end_at,
      expected_profit,
      accrued_profit,
      status,
      created_at,
      updated_at,
      LEAST(
        expected_profit,
        expected_profit *
        GREATEST(
          0,
          EXTRACT(EPOCH FROM (now() - start_at)) /
          EXTRACT(EPOCH FROM (end_at - start_at))
        )
      ) AS computed_accrued_profit
    FROM investment_cycles
    WHERE user_id = $1
      AND wallet_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId, walletId]
  );

  if (!res.rows.length) return null;

  const row = res.rows[0];

  const expected = Number(row.expected_profit);
  const accrued =
    row.status === 'active'
      ? Number(row.computed_accrued_profit)
      : Number(row.accrued_profit);

  const progressPercent =
    expected === 0 ? 0 : Math.min(100, (accrued / expected) * 100);

  return {
    ...row,
    accrued_profit: accrued,
    progress_percent: Number(progressPercent.toFixed(2)),
  };
}


module.exports = {
  startCycle,
  stopCycle,
  getCurrentCycle,
};