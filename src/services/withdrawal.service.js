'use strict';

const { pool } = require('../config/database');
const {
  applyWalletDelta,
  lockFunds,
  unlockFunds
} = require('./wallet.service');


// ======================================================
// CREATE WITHDRAWAL REQUEST
// ======================================================

async function createWithdrawalRequest(
  userId,
  walletId,
  amountUsd,
  destination,
  method
) {
  const amountCents = Math.round(
    Number(amountUsd) * 100
  );

  if (
    !Number.isFinite(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error('Invalid amount');
  }

  if (
    typeof destination !== 'string' ||
    destination.trim().length < 5
  ) {
    throw new Error('Invalid destination');
  }

  if (!['BANK', 'CRYPTO'].includes(method)) {
    throw new Error('Invalid withdrawal method');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // VERIFY LIVE ACCOUNT
    // ==================================================

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

    if (account.status !== 'ACTIVE') {
      throw new Error('Live wallet is not active');
    }

    const balanceCents =
      Number(account.balance_cents || 0);

    // ==================================================
    // IMPORTANT:
    //
    // balance_cents is the AVAILABLE balance.
    //
    // locked_balance_cents is already separated from
    // the available balance.
    // ==================================================

    if (balanceCents < amountCents) {
      throw new Error('Insufficient balance');
    }

    // ==================================================
    // LOCK THE WITHDRAWAL AMOUNT
    //
    // This prevents the same funds from being used
    // for another withdrawal or investment while
    // this request is pending.
    // ==================================================

    await lockFunds(
      client,
      userId,
      'LIVE',
      amountCents
    );

    // ==================================================
    // CREATE WITHDRAWAL
    // ==================================================

    const {
      rows: [withdrawal]
    } = await client.query(
      `
      INSERT INTO withdrawals
      (
        user_id,
        wallet_id,
        amount_cents,
        currency,
        destination,
        method,
        status
      )
      VALUES
      (
        $1,
        $2,
        $3,
        'USD',
        $4,
        $5,
        'PENDING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        amountCents,
        destination.trim(),
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



// ======================================================
// CANCEL WITHDRAWAL
// ======================================================

async function cancelWithdrawal(
  userId,
  withdrawalId
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // LOCK WITHDRAWAL
    // ==================================================

    const {
      rows
    } = await client.query(
      `
      SELECT
        id,
        user_id,
        wallet_id,
        amount_cents,
        status
      FROM withdrawals
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [
        withdrawalId,
        userId
      ]
    );

    if (!rows.length) {
      throw new Error('Withdrawal not found');
    }

    const withdrawal = rows[0];

    // Already cancelled
    if (withdrawal.status === 'CANCELLED') {
      await client.query('COMMIT');

      return {
        success: true
      };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error(
        'Withdrawal cannot be cancelled'
      );
    }

    // ==================================================
    // RELEASE LOCKED FUNDS
    // ==================================================

    await unlockFunds(
      client,
      userId,
      'LIVE',
      Number(withdrawal.amount_cents)
    );

    // ==================================================
    // CANCEL WITHDRAWAL
    // ==================================================

    await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'CANCELLED',
        cancelled_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [withdrawalId]
    );

    await client.query('COMMIT');

    return {
      success: true
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}



// ======================================================
// LIST USER WITHDRAWALS
// ======================================================

async function listUserWithdrawals(userId) {
  const {
    rows
  } = await pool.query(
    `
    SELECT
      id,
      wallet_id,
      amount_cents,
      currency,
      method,
      destination,
      status,
      approved_at,
      rejected_at,
      completed_at,
      cancelled_at,
      rejection_reason,
      admin_notes,
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



// ======================================================
// APPROVE WITHDRAWAL - ADMIN
// ======================================================

async function approveWithdrawal(
  withdrawalId,
  adminId
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // LOCK WITHDRAWAL
    // ==================================================

    const {
      rows
    } = await client.query(
      `
      SELECT
        id,
        user_id,
        wallet_id,
        amount_cents,
        status
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

    // ==================================================
    // IDEMPOTENCY
    // ==================================================

    if (
      withdrawal.status === 'APPROVED' ||
      withdrawal.status === 'COMPLETED'
    ) {
      await client.query('COMMIT');

      return {
        success: true
      };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error(
        'Withdrawal cannot be approved'
      );
    }

    const amountCents =
      Number(withdrawal.amount_cents);

    // ==================================================
    // VERIFY LIVE ACCOUNT
    // ==================================================

    const {
      rows: accountRows
    } = await client.query(
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
      [
        withdrawal.wallet_id,
        withdrawal.user_id
      ]
    );

    if (!accountRows.length) {
      throw new Error('Live wallet not found');
    }

    const account = accountRows[0];

    if (account.status !== 'ACTIVE') {
      throw new Error(
        'Live wallet is not active'
      );
    }

    const lockedBalance =
      Number(account.locked_balance_cents || 0);

    if (lockedBalance < amountCents) {
      throw new Error(
        'Withdrawal funds are not properly locked'
      );
    }

    // ==================================================
    // RELEASE THE RESERVED FUNDS
    //
    // unlockFunds:
    //
    // balance:  15,000 -> 20,000
    // locked:   5,000  -> 0
    //
    // Then debit:
    //
    // balance:  20,000 -> 15,000
    // ==================================================

    await unlockFunds(
      client,
      withdrawal.user_id,
      'LIVE',
      amountCents
    );

    // ==================================================
    // ACTUAL WALLET DEBIT
    //
    // This creates the financial transaction.
    // ==================================================

    await applyWalletDelta(
      client,
      withdrawal.user_id,
      'LIVE',
      -amountCents,
      'WITHDRAWAL_APPROVED',
      {
        refType: 'withdrawal',
        refId: withdrawal.id,
        reference: `WITHDRAWAL-${withdrawal.id}`,
        meta: {
          withdrawal_id: withdrawal.id,
          method: withdrawal.method || null,
          wallet_id: withdrawal.wallet_id
        }
      }
    );

    // ==================================================
    // UPDATE WITHDRAWAL
    // ==================================================

    await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'APPROVED',
        approved_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [withdrawalId]
    );

    // ==================================================
    // ADMIN AUDIT
    // ==================================================

    await client.query(
      `
      INSERT INTO admin_audit_logs
      (
        admin_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5
      )
      `,
      [
        adminId,
        'APPROVE_WITHDRAWAL',
        'withdrawal',
        withdrawalId,
        JSON.stringify({
          user_id: withdrawal.user_id,
          wallet_id: withdrawal.wallet_id,
          amount_cents: amountCents
        })
      ]
    );

    await client.query('COMMIT');

    return {
      success: true
    };

  } catch (err) {

    await client.query('ROLLBACK');

    throw err;

  } finally {
    client.release();
  }
}



// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  createWithdrawalRequest,
  cancelWithdrawal,
  approveWithdrawal,
  listUserWithdrawals
};