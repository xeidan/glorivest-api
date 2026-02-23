'use strict';

const { pool } = require('../config/database');

async function createBankDeposit(userId, amountRequestedCents) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const suffix = Math.floor(Math.random() * 90) + 10;
    const exactAmount = amountRequestedCents + suffix;

    const reference = `GV-${Date.now()}-${Math.floor(Math.random()*9999)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const { rows } = await client.query(
      `
      INSERT INTO deposits (
        user_id,
        amount_requested_cents,
        amount_exact_cents,
        reference,
        method,
        status,
        expires_at
      )
      VALUES ($1,$2,$3,$4,'BANK','AWAITING_PAYMENT',$5)
      RETURNING *
      `,
      [
        userId,
        amountRequestedCents,
        exactAmount,
        reference,
        expiresAt
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

async function markDepositPaid(userId, depositId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT *
      FROM deposits
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [depositId, userId]
    );

    if (!rows.length) {
      throw new Error('Deposit not found');
    }

    if (rows[0].status !== 'AWAITING_PAYMENT') {
      throw new Error('Invalid deposit state');
    }

    await client.query(
      `
      UPDATE deposits
      SET status = 'USER_MARKED_PAID'
      WHERE id = $1
      `,
      [depositId]
    );

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createBankDeposit,
  markDepositPaid
};