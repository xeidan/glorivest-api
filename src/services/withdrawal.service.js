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
    !Number.isInteger(amountCents) ||
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
    // LOCK THE LIVE ACCOUNT
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

    const lockedBalanceCents =
      Number(account.locked_balance_cents || 0);

    // ==================================================
    // AVAILABLE BALANCE
    //
    // Total balance stays unchanged.
    //
    // Available =
    // balance - already locked funds
    // ==================================================

    const availableCents =
      balanceCents - lockedBalanceCents;

    if (availableCents < amountCents) {
      throw new Error('Insufficient available balance');
    }

    // ==================================================
    // LOCK WITHDRAWAL FUNDS
    //
    // IMPORTANT:
    //
    // balance_cents DOES NOT change here.
    //
    // Example:
    //
    // balance:  25000
    // locked:       0
    //
    // Withdraw 5000
    //
    // balance:  25000
    // locked:    5000
    // available: 20000
    // ==================================================

    const newLockedBalance =
      lockedBalanceCents + amountCents;

    await client.query(
      `
      UPDATE accounts
      SET
        locked_balance_cents = $1
      WHERE id = $2
      `,
      [
        newLockedBalance,
        account.id
      ]
    );

    // ==================================================
    // CREATE WITHDRAWAL REQUEST
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

    const id = Number(withdrawalId);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid withdrawal ID');
    }

    // ==================================================
    // LOCK WITHDRAWAL + VERIFY OWNERSHIP
    // ==================================================

    const {
      rows: [withdrawal]
    } = await client.query(
      `
      SELECT
        w.id,
        w.user_id,
        w.wallet_id,
        w.amount_cents,
        w.status,
        a.account_type,
        a.status AS account_status
      FROM withdrawals w
      INNER JOIN accounts a
        ON a.id = w.wallet_id
      WHERE w.id = $1
        AND w.user_id = $2
        AND a.account_type = 'LIVE'
      FOR UPDATE
      `,
      [id, userId]
    );

    if (!withdrawal) {
      throw new Error('Withdrawal not found');
    }

    // ==================================================
    // ONLY PENDING WITHDRAWALS CAN BE CANCELLED
    // ==================================================

    if (withdrawal.status === 'CANCELLED') {
      await client.query('COMMIT');

      return {
        success: true,
        message: 'Withdrawal already cancelled'
      };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error(
        `Withdrawal cannot be cancelled from status ${withdrawal.status}`
      );
    }

    if (withdrawal.account_status !== 'ACTIVE') {
      throw new Error('Live wallet is not active');
    }

    const amountCents =
      Number(withdrawal.amount_cents);

    if (
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new Error('Invalid withdrawal amount');
    }

    // ==================================================
    // RELEASE THE RESERVED FUNDS
    //
    // balance:
    //   15,000 -> 20,000
    //
    // locked:
    //   5,000 -> 0
    //
    // available:
    //   10,000 -> 20,000
    // ==================================================

    await unlockFunds(
      client,
      userId,
      'LIVE',
      amountCents
    );

    // ==================================================
    // MARK WITHDRAWAL CANCELLED
    // ==================================================

    const {
      rows: [updatedWithdrawal]
    } = await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'CANCELLED',
        cancelled_at = now(),
        updated_at = now()
      WHERE id = $1
        AND user_id = $2
        AND status = 'PENDING'
      RETURNING *
      `,
      [id, userId]
    );

    if (!updatedWithdrawal) {
      throw new Error(
        'Withdrawal status changed before cancellation'
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      withdrawal: updatedWithdrawal
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



// =========================
// Approve Withdrawal (Admin)
// =========================
async function approveWithdrawal(withdrawalId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // LOCK WITHDRAWAL
    // ==================================================

    const { rows } = await client.query(
      `
      SELECT
        id,
        user_id,
        wallet_id,
        amount_cents,
        method,
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

    if (withdrawal.status === 'APPROVED') {
      await client.query('COMMIT');

      return {
        success: true,
        message: 'Withdrawal already approved'
      };
    }

    if (withdrawal.status !== 'PENDING') {
      throw new Error(
        `Withdrawal cannot be approved from status ${withdrawal.status}`
      );
    }

    const amountCents =
      Number(withdrawal.amount_cents);

    if (
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new Error('Invalid withdrawal amount');
    }

    // ==================================================
    // LOCK LIVE ACCOUNT
    // ==================================================

    const { rows: accountRows } = await client.query(
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
    // RELEASE RESERVED FUNDS
    //
    // Example:
    //
    // balance:  15,000 -> 20,000
    // locked:   15,000 -> 10,000
    // ==================================================

    await unlockFunds(
      client,
      withdrawal.user_id,
      'LIVE',
      amountCents
    );

    // ==================================================
    // ACTUAL WITHDRAWAL DEBIT
    //
    // Example:
    //
    // balance:  20,000 -> 15,000
    //
    // This creates:
    // WITHDRAWAL_APPROVED
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
          idempotencyKey: `withdrawal:${withdrawal.id}:approved`,
          reference: `WITHDRAWAL-${withdrawal.id}`,
          meta: {
            withdrawal_id: withdrawal.id,
            method: withdrawal.method || null,
            wallet_id: withdrawal.wallet_id,
            approved_by: adminId
          }
        }
      );

    // ==================================================
    // UPDATE WITHDRAWAL
    // ==================================================

    const { rows: updatedRows } = await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'APPROVED',
        approved_at = now(),
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [withdrawalId]
    );

    await client.query('COMMIT');

    return {
      success: true,
      withdrawal: updatedRows[0]
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