'use strict';

const { pool } = require('../config/database');

// -----------------------------
// START CYCLE
// -----------------------------
async function startCycle({ userId, walletId, expectedProfit }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure wallet belongs to user
    const walletRes = await client.query(
      `SELECT id FROM wallets WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );

    if (walletRes.rowCount === 0) {
      throw new Error('Wallet not found or not owned by user');
    }

    // Ensure no active cycle
    const activeRes = await client.query(
      `
      SELECT id FROM investment_cycles
      WHERE wallet_id = $1 AND status = 'active'
      `,
      [walletId]
    );

    if (activeRes.rowCount > 0) {
      throw new Error('Active investment cycle already exists');
    }

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const insertRes = await client.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, start_at, end_at, expected_profit, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
      `,
      [userId, walletId, startAt, endAt, expectedProfit]
    );

    await client.query('COMMIT');
    return insertRes.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------
// STOP CYCLE (FORFEIT)
// -----------------------------
async function stopCycle({ userId, walletId }) {
  const res = await pool.query(
    `
    UPDATE investment_cycles
    SET
      status = 'forfeited',
      accrued_profit = 0,
      updated_at = now()
    WHERE user_id = $1
      AND wallet_id = $2
      AND status = 'active'
    RETURNING *
    `,
    [userId, walletId]
  );

  if (res.rowCount === 0) {
    throw new Error('No active cycle to stop');
  }

  return res.rows[0];
}

// -----------------------------
// GET CURRENT CYCLE
// -----------------------------
async function getCurrentCycle(req, res) {
  try {
    const userId = req.user.id;
    const walletId = Number(req.query.walletId);

    if (!walletId) {
      return res.status(400).json({ error: 'walletId is required' });
    }

    const result = await pool.query(
      `
      SELECT
        *,
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
        AND status = 'active'
      LIMIT 1
      `,
      [userId, walletId]
    );

    res.json({
      cycle: result.rows[0] || null
    });

  } catch (err) {
    console.error('getCurrentCycle error', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  startCycle,
  stopCycle,
  getCurrentCycle
};
