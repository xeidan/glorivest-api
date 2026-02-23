'use strict';

const { pool } = require('../config/database');
const { applyWalletDelta } = require('./wallet.service');
const { processReferralReward } = require('./referralReward.service');

async function approveDeposit(depositId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, user_id, amount_exact_cents, status, referral_rewarded
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

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error('Invalid deposit state');
    }

    // Credit wallet using exact amount sent
    await applyWalletDelta(
      client,
      deposit.user_id,
      'REAL',
      Number(deposit.amount_exact_cents),
      'DEPOSIT_SUCCESS'
    );

    // Optional referral reward (only once)
    if (!deposit.referral_rewarded) {
      await processReferralReward(
        client,
        deposit.user_id,
        Number(deposit.amount_exact_cents)
      );

      await client.query(
        `
        UPDATE deposits
        SET referral_rewarded = true
        WHERE id = $1
        `,
        [depositId]
      );
    }

    // Finalize deposit
    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS'
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

module.exports = { approveDeposit };