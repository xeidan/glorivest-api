// src/services/withdrawal.service.js
'use strict';

const { pool } = require('../config/database');
const tron = require('../crypto/tron');
const { withTx } = require('../config/database');

// =========================
// Create Withdrawal Request
// =========================
exports.createWithdrawalRequest = async (userId, amountUsd, address) => {
  amountUsd = Number(amountUsd);

  const userQ = await pool.query(
    `SELECT balance FROM users WHERE id=$1`,
    [userId]
  );

  if (!userQ.rows.length)
    throw new Error('User not found');

  const balance = Number(userQ.rows[0].balance);

  if (balance < amountUsd)
    throw new Error('Insufficient balance');

  return await withTx(async (c) => {
    await c.query(
      `UPDATE users SET balance = balance - $1 WHERE id=$2`,
      [amountUsd, userId]
    );

    const w = await c.query(
      `INSERT INTO withdrawals (user_id, amount, address)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [userId, amountUsd, address]
    );

    return w.rows[0];
  });
};


// =========================
// List user withdrawals
// =========================
exports.listWithdrawals = async (userId) => {
  const q = await pool.query(
    `SELECT * FROM withdrawals 
     WHERE user_id=$1
     ORDER BY created_at DESC`,
    [userId]
  );
  return q.rows;
};


// =========================
// Worker: Broadcast pending withdrawals
// =========================
exports.processWithdrawalsOnce = async () => {
  // Get pending withdrawals
  const { rows } = await pool.query(`
    SELECT * FROM withdrawals 
    WHERE status='pending'
    LIMIT 20
  `);

  for (const w of rows) {
    try {
      const tx = await tron.sendFromOmnibus(w.address, w.amount);

      await pool.query(
        `UPDATE withdrawals
         SET tx_hash=$1, status='broadcasted', broadcasted_at=NOW()
         WHERE id=$2`,
        [tx, w.id]
      );
    } catch (err) {
      console.error('broadcast error:', err);
      await pool.query(
        `UPDATE withdrawals SET status='failed' WHERE id=$1`,
        [w.id]
      );
    }
  }
};


// =========================
// Worker: Confirm broadcasted withdrawals
// =========================
exports.confirmWithdrawalsOnce = async () => {
  const { rows } = await pool.query(`
    SELECT id, tx_hash FROM withdrawals
    WHERE status='broadcasted'
  `);

  for (const w of rows) {
    const r = await tron.getReceipt(w.tx_hash);
    if (!r.found) continue;

    if (r.ok) {
      await pool.query(
        `UPDATE withdrawals
         SET status='confirmed', confirmed_at=NOW()
         WHERE id=$1`,
        [w.id]
      );
    } else {
      await pool.query(
        `UPDATE withdrawals
         SET status='failed'
         WHERE id=$1`,
        [w.id]
      );
    }
  }
};
