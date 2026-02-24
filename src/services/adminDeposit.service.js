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
      SELECT id,
             user_id,
             amount_exact_cents,
             status,
             referral_rewarded,
             expires_at
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

    // Expiry enforcement
    if (deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
      throw new Error('Deposit expired');
    }

    if (deposit.status !== 'USER_MARKED_PAID') {
      throw new Error('Invalid deposit state');
    }

    // 1️⃣ Credit REAL wallet (must include deposit reference internally)
    await applyWalletDelta(
      client,
      deposit.user_id,
      'REAL',
      Number(deposit.amount_exact_cents),
      'DEPOSIT_SUCCESS',
      {
        refType: 'DEPOSIT',
        refId: deposit.id
      }
    );

    // 2️⃣ Process referral reward (idempotent at DB level)
    if (!deposit.referral_rewarded) {
      await processReferralReward(
        client,
        deposit.user_id,
        Number(deposit.amount_exact_cents),
        deposit.id
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

    // 3️⃣ Finalize deposit status
    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS'
      WHERE id = $1
      `,
      [depositId]
    );

    // 4️⃣ First deposit concurrency-safe update
    await client.query(
      `
      UPDATE users
      SET first_deposit_done = true
      WHERE id = $1
        AND first_deposit_done = false
      `,
      [deposit.user_id]
    );

    // 5️⃣ Admin audit log (atomic with approval)
    await client.query(
      `
      INSERT INTO admin_audit_logs
      (admin_id, action, entity_type, entity_id, metadata)
      VALUES ($1, 'DEPOSIT_APPROVED', 'DEPOSIT', $2, $3)
      `,
      [
        adminId,
        depositId,
        JSON.stringify({
          amount_exact_cents: deposit.amount_exact_cents
        })
      ]
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