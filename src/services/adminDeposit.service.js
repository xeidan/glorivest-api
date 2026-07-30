'use strict';

const { pool } = require('../config/database');
const { applyWalletDelta } = require('./wallet.service');
// const { processReferralReward } = require('./referralReward.service');
// Referral rewards will be migrated after the new financial engine is complete.

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

    // Ensure deposit has not expired
    if (deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
      throw new Error('Deposit expired');
    }

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error('Invalid deposit state');
    }

    // Credit user's investment account
    await applyWalletDelta(
      client,
      deposit.user_id,
      Number(deposit.amount_exact_cents),
      'DEPOSIT_SUCCESS',
      {
        refType: 'DEPOSIT',
        refId: deposit.id,
        idempotencyKey: `deposit:${deposit.id}`,
        reference: deposit.reference
      }
    );

    /*
     * Referral rewards temporarily disabled.
     * This will be reintroduced using the new account engine
     * instead of the legacy wallet implementation.
     */
    /*
    await processReferralReward(
      client,
      deposit.user_id,
      Number(deposit.amount_exact_cents),
      deposit.id
    );
    */

    // Mark deposit successful
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
     * first_deposit_done no longer exists in the schema.
     * We'll determine first deposits from successful deposit history.
     */

    // Admin audit log
console.log(
  `Deposit ${deposit.id} approved by admin ${adminId}`
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

module.exports = {
  approveDeposit
};