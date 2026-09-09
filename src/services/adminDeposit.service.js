'use strict';

const { pool } = require('../config/database');

/**
 * Approve a user-marked deposit.
 *
 * Financial flow:
 *
 * deposits
 *   ↓
 * accounts.balance_cents
 *   ↓
 * ledger
 *   ↓
 * transactions
 *
 * Deposits always credit the LIVE account.
 *
 * IMPORTANT:
 * - balance_cents = total available LIVE balance
 * - locked_balance_cents = funds committed elsewhere
 * - approving a deposit does NOT change locked_balance_cents
 * - ledger is the immutable financial record
 * - transactions is the user-facing transaction history
 */
async function approveDeposit(depositId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // LOCK DEPOSIT
    // ==================================================

    const { rows } = await client.query(
      `
      SELECT
        id,
        user_id,
        amount_exact_cents,
        status,
        expires_at,
        reference
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

    // ==================================================
    // ALREADY SUCCESSFUL
    //
    // Safe idempotent behavior.
    // ==================================================

    if (deposit.status === 'SUCCESS') {
      await client.query('COMMIT');

      return {
        success: true,
        alreadyProcessed: true,
        depositId: deposit.id
      };
    }

    // ==================================================
    // VALIDATE STATE
    // ==================================================

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error(
        `Invalid deposit state: ${deposit.status}`
      );
    }



    // ==================================================
    // AMOUNT
    // ==================================================

    const amountCents =
      Number(deposit.amount_exact_cents);

    if (
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new Error('Invalid deposit amount');
    }

    // ==================================================
    // LOCK LIVE ACCOUNT
    // ==================================================

    const accountRes = await client.query(
      `
      SELECT
        id,
        user_id,
        account_type,
        balance_cents,
        locked_balance_cents,
        status
      FROM accounts
      WHERE user_id = $1
        AND account_type = 'LIVE'
      LIMIT 1
      FOR UPDATE
      `,
      [deposit.user_id]
    );

    if (!accountRes.rows.length) {
      throw new Error('LIVE account not found');
    }

    const account = accountRes.rows[0];

    if (account.status !== 'ACTIVE') {
      throw new Error('LIVE account is not active');
    }

    // ==================================================
    // IDEMPOTENCY CHECK
    //
    // One deposit can produce only one financial
    // ledger entry.
    // ==================================================

    const idempotencyKey =
      `deposit:${deposit.id}`;

    const existingLedger = await client.query(
      `
      SELECT
        id,
        account_id,
        amount_cents
      FROM ledger
      WHERE idempotency_key = $1
      LIMIT 1
      FOR UPDATE
      `,
      [idempotencyKey]
    );

    if (existingLedger.rows.length) {
      throw new Error(
        'Deposit has already been processed'
      );
    }

    // ==================================================
    // CALCULATE NEW BALANCE
    // ==================================================

    const currentBalance =
      Number(account.balance_cents || 0);

    const newBalance =
      currentBalance + amountCents;

    // ==================================================
    // CREDIT LIVE ACCOUNT
    // ==================================================

    await client.query(
      `
      UPDATE accounts
      SET
        balance_cents = $1
      WHERE id = $2
      `,
      [
        newBalance,
        account.id
      ]
    );

    // ==================================================
    // IMMUTABLE LEDGER ENTRY
    // ==================================================

    await client.query(
      `
      INSERT INTO ledger
      (
        user_id,
        account_id,
        type,
        amount_cents,
        ref_type,
        ref_id,
        idempotency_key
      )
      VALUES
      (
        $1,
        $2,
        'DEPOSIT_SUCCESS',
        $3,
        'DEPOSIT',
        $4,
        $5
      )
      `,
      [
        deposit.user_id,
        account.id,
        amountCents,
        deposit.id,
        idempotencyKey
      ]
    );

    // ==================================================
    // USER TRANSACTION HISTORY
    //
    // This is what the frontend transaction UI can read.
    // ==================================================

    await client.query(
      `
      INSERT INTO transactions
      (
        user_id,
        account_id,
        type,
        amount_cents,
        balance_after_cents,
        reference,
        meta
      )
      VALUES
      (
        $1,
        $2,
        'DEPOSIT_SUCCESS',
        $3,
        $4,
        $5,
        $6
      )
      `,
      [
        deposit.user_id,
        account.id,
        amountCents,
        newBalance,
        deposit.reference || null,
        JSON.stringify({
          deposit_id: deposit.id,
          account_type: 'LIVE',
          approved_by: adminId
        })
      ]
    );

    // ==================================================
    // MARK DEPOSIT SUCCESS
    // ==================================================

    await client.query(
      `
      UPDATE deposits
      SET
        status = 'SUCCESS',
        updated_at = NOW()
      WHERE id = $1
      `,
      [deposit.id]
    );



    await client.query('COMMIT');

    return {
      success: true,
      depositId: deposit.id,
      userId: deposit.user_id,
      accountId: account.id,
      accountType: 'LIVE',
      amountCents,
      balanceCents: newBalance
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}

module.exports = {
  approveDeposit
};