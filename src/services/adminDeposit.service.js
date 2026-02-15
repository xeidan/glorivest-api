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
      SELECT id, user_id, amount_cents, status
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
      throw new Error('Deposit already processed');
    }

    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS',
          approved_by = $1,
          approved_at = NOW()
      WHERE id = $2
      `,
      [adminId, depositId]
    );

    await applyWalletDelta(
      client,
      deposit.user_id,
      'REAL',
      deposit.amount_cents,
      'DEPOSIT_SUCCESS'
    );

    await processReferralReward(
      client,
      deposit.user_id,
      deposit.amount_cents
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
