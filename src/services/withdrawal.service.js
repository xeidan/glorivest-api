'use strict';

const { pool } = require('../config/database');
const { applyWalletDelta } = require('./wallet.service');


// =========================
// Create Withdrawal Request
// =========================
async function createWithdrawalRequest(
  userId,
  walletId,
  amountUsd,
  destination,
  method
) {
  const amountCents = Math.round(Number(amountUsd) * 100);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Invalid amount');
  }

  if (typeof destination !== 'string' || destination.length < 5) {
    throw new Error('Invalid destination');
  }

  if (!['BANK', 'CRYPTO'].includes(method)) {
    throw new Error('Invalid withdrawal method');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // =========================
    // Lock LIVE account
    // =========================
    const { rows } = await client.query(
      `
      SELECT
        id,
        user_id,
        account_type,
        balance_cents,
        locked_balance_cents,
        status
      FROM accounts
      WHERE id = $1
        AND user_id = $2
        AND account_type = 'LIVE'
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!rows.length) {
      throw new Error('Live wallet not found');
    }

    const account = rows[0];

    const balance = Number(account.balance_cents || 0);
    const lockedBalance = Number(account.locked_balance_cents || 0);

    // =========================
    // Calculate available balance
    // =========================
    const availableBalance = balance - lockedBalance;

    if (availableBalance < amountCents) {
      throw new Error('Insufficient balance');
    }

    // =========================
    // Create withdrawal request
    // =========================
    const { rows: [withdrawal] } = await client.query(
      `
      INSERT INTO withdrawals
        (
          user_id,
          wallet_id,
          amount_cents,
          destination,
          method,
          status
        )
      VALUES
        ($1, $2, $3, $4, $5, 'PENDING')
      RETURNING *
      `,
      [
        userId,
        account.id,
        amountCents,
        destination,
        method
      ]
    );

    await client.query('COMMIT');

    return withdrawal;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}



// =========================
// Cancel Withdrawal
// =========================
async function cancelWithdrawal(userId, withdrawalId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, status
      FROM withdrawals
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [withdrawalId, userId]
    );

    if (!rows.length) {
      throw new Error('Withdrawal not found');
    }

    const withdrawal = rows[0];

    if (withdrawal.status === 'CANCELLED') {
      await client.query('COMMIT');
      return { success: true };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error('Withdrawal cannot be cancelled');
    }

    await client.query(
      `
      UPDATE withdrawals
      SET status = 'CANCELLED',
          updated_at = now()
      WHERE id = $1
      `,
      [withdrawalId]
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
// List User Withdrawals
// =========================
async function listUserWithdrawals(userId) {
  const { rows } = await pool.query(
    `
    SELECT id,
           wallet_id,
           amount_cents,
           method,
           destination,
           status,
           created_at,
           updated_at
    FROM withdrawals
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  return rows;
}



// =========================
// Approve Withdrawal (Admin)
// =========================
async function approveWithdrawal(withdrawalId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, user_id, wallet_id, amount_cents, status
      FROM withdrawals
      WHERE id = $1
      FOR UPDATE
      `,
      [withdrawalId]
    );

    if (!rows.length) {
      throw new Error('Withdrawal not found');
    }

    const withdrawal = rows[0];

    // Idempotent
    if (withdrawal.status === 'APPROVED') {
      await client.query('COMMIT');
      return { success: true };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error('Withdrawal cannot be approved');
    }

    // 🔒 Debit wallet safely
    await applyWalletDelta(
      client,
      withdrawal.user_id,
      'REAL',
      -Number(withdrawal.amount_cents),
      'WITHDRAWAL_APPROVED'
    );

    await client.query(
      `
      UPDATE withdrawals
      SET status = 'APPROVED',
          updated_at = now()
      WHERE id = $1
      `,
      [withdrawalId]
    );

    await client.query(
      `
      INSERT INTO admin_audit_logs
        (admin_id, action, entity_type, entity_id, metadata)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        adminId,
        'APPROVE_WITHDRAWAL',
        'withdrawal',
        withdrawalId,
        JSON.stringify({
          user_id: withdrawal.user_id,
          amount_cents: withdrawal.amount_cents
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
          'FAILED_APPROVE_WITHDRAWAL',
          'withdrawal',
          withdrawalId,
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



module.exports = {
  createWithdrawalRequest,
  cancelWithdrawal,
  approveWithdrawal,
  listUserWithdrawals
};