'use strict';

const { pool } = require('../config/database');

// =========================
// Create Bank Deposit
// =========================
async function createBankDeposit(userId, amountRequestedCents) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const suffix = Math.floor(Math.random() * 90) + 10;
    const exactAmount = amountRequestedCents + suffix;

    const reference = `GV-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
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


// =========================
// Mark Deposit Paid (User)
// =========================
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

    const deposit = rows[0];

    // 🔒 Expiry enforcement
    if (deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
      throw new Error('Deposit expired');
    }

    if (deposit.status !== 'AWAITING_PAYMENT') {
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


// =========================
// Cancel Deposit (User)
// =========================
async function cancelDeposit(userId, depositId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, status
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

    const deposit = rows[0];

    if (deposit.status === 'SUCCESS') {
      throw new Error('Cannot cancel completed deposit');
    }

    if (
      deposit.status === 'CANCELLED' ||
      deposit.status === 'EXPIRED'
    ) {
      await client.query('COMMIT');
      return { success: true };
    }

    await client.query(
      `
      UPDATE deposits
      SET status = 'CANCELLED'
      WHERE id = $1
      `,
      [depositId]
    );

    await client.query('COMMIT');

    return { success: true };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}



// =========================
// Approve Deposit (Admin)
// =========================
async function approveDeposit(depositId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, user_id, amount_exact_cents, status
      FROM deposits
      WHERE id = $1
      FOR UPDATE
      `,
      [depositId]
    );

    if (!rows.length) {
      throw new Error('Deposit not found');
    }

    const deposit = rows[0];

    if (deposit.status === 'SUCCESS') {
      await client.query('COMMIT');
      return { success: true };
    }

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error('Invalid deposit state');
    }

    await applyWalletDelta(
      client,
      deposit.user_id,
      'REAL',
      Number(deposit.amount_exact_cents),
      'DEPOSIT_SUCCESS'
    );

    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS'
      WHERE id = $1
      `,
      [depositId]
    );

    // 🔐 Success audit
    await client.query(
      `
      INSERT INTO admin_audit_logs
        (admin_id, action, entity_type, entity_id, metadata)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        adminId,
        'APPROVE_DEPOSIT',
        'deposit',
        depositId,
        JSON.stringify({
          user_id: deposit.user_id,
          amount_cents: deposit.amount_exact_cents
        })
      ]
    );

    await client.query('COMMIT');
    return { success: true };

  } catch (err) {

    try {
      await client.query(
        `
        INSERT INTO admin_audit_logs
          (admin_id, action, entity_type, entity_id, metadata)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          adminId,
          'FAILED_APPROVE_DEPOSIT',
          'deposit',
          depositId,
          JSON.stringify({ error: err.message })
        ]
      );
    } catch (_) {}

    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}

// =========================
// List User Deposits
// =========================
async function listUserDeposits(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      amount_requested_cents,
      amount_exact_cents,
      reference,
      method,
      status,
      expires_at,
      created_at
    FROM deposits
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  return rows;
}

module.exports = {
  createBankDeposit,
  markDepositPaid,
  cancelDeposit,
  approveDeposit,
  listUserDeposits
};