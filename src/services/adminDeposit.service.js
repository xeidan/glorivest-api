'use strict';

const { pool } = require('../config/database');

async function approveDeposit(depositId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    if (
      deposit.expires_at &&
      new Date(deposit.expires_at) < new Date()
    ) {
      throw new Error('Deposit expired');
    }

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error(
        `Invalid deposit state: ${deposit.status}`
      );
    }

    /*
     * Deposits always credit the LIVE account.
     * DEMO and REFERRAL balances remain untouched.
     */
    const accountRes = await client.query(
      `
      SELECT
        id,
        user_id,
        account_type,
        balance_cents,
        locked_balance_cents
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

    const amountCents =
      Number(deposit.amount_exact_cents);

    if (
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new Error('Invalid deposit amount');
    }

    const currentBalance =
      Number(account.balance_cents);

    const newBalance =
      currentBalance + amountCents;

    /*
     * Idempotency protection.
     */
    const existingLedger = await client.query(
      `
      SELECT id
      FROM ledger
      WHERE idempotency_key = $1
      LIMIT 1
      `,
      [`deposit:${deposit.id}`]
    );

    if (existingLedger.rows.length) {
      throw new Error('Deposit has already been processed');
    }

    /*
     * Update LIVE account balance.
     */
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

    /*
     * Immutable ledger entry.
     */
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
        `deposit:${deposit.id}`
      ]
    );

    /*
     * User transaction history.
     */
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
        deposit.reference,
        JSON.stringify({
          deposit_id: deposit.id,
          account_type: 'LIVE'
        })
      ]
    );

    /*
     * Mark deposit successful.
     */
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

    /*
     * Admin audit log.
     *
     * Keep this optional because the table may not exist
     * in every environment.
     */
    console.log(
      `Deposit ${deposit.id} approved by admin ${adminId} ` +
      `for LIVE account ${account.id}`
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