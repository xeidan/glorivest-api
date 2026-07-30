'use strict';

const { pool } = require('../config/database');
const { applyWalletDelta } = require('./wallet.service');
// const { processReferralReward } = require('./referralReward.service');

async function approveDeposit(depositId, adminId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('==============================');
    console.log('APPROVE DEPOSIT START');
    console.log('Deposit ID:', depositId);
    console.log('Admin ID:', adminId);

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

    console.log('Deposit lookup rows:', rows.length);

    if (!rows.length) {
      throw new Error('Deposit not found');
    }

    const deposit = rows[0];

    console.log('Deposit:', deposit);

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

    console.log('Calling applyWalletDelta...');

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

    console.log('applyWalletDelta completed.');

    console.log('Updating deposit status...');

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

    console.log('Deposit status updated.');

    console.log('Writing admin audit log...');

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
        'DEPOSIT_APPROVED',
        'DEPOSIT',
        $2,
        $3
      )
      `,
      [
        adminId,
        deposit.id,
        JSON.stringify({
          amount_exact_cents: deposit.amount_exact_cents
        })
      ]
    );

    console.log('Admin audit log written.');

    await client.query('COMMIT');

    console.log('APPROVE DEPOSIT SUCCESS');
    console.log('==============================');

    return {
      success: true
    };

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('==============================');
    console.error('APPROVE DEPOSIT FAILED');
    console.error(err);
    console.error(err.stack);
    console.error('==============================');

    throw err;

  } finally {
    client.release();
  }
}

module.exports = {
  approveDeposit
};