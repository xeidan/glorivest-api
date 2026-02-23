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



module.exports = {
  createBankDeposit
};