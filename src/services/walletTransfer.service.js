'use strict';

const { pool } = require('../config/database');

async function transferToMainWallet({
  userId,
  amountCents,
  source // 'BOT' | 'REFERRAL'
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error('Invalid transfer amount');
    }

    /* =========================================================
       LOCK REAL WALLET
    ========================================================= */
    const realRes = await client.query(
      `
      SELECT id, balance_cents
      FROM wallets
      WHERE user_id = $1
        AND type = 'REAL'
      FOR UPDATE
      `,
      [userId]
    );

    if (!realRes.rowCount) {
      throw new Error('Main wallet not found');
    }

    const realWallet = realRes.rows[0];

    /* =========================================================
       REFERRAL FLOW
    ========================================================= */
    if (source === 'REFERRAL') {

      const referralRes = await client.query(
        `
        SELECT id, balance_cents
        FROM wallets
        WHERE user_id = $1
          AND type = 'REFERRAL'
        FOR UPDATE
        `,
        [userId]
      );

      if (!referralRes.rowCount) {
        throw new Error('Referral wallet not found');
      }

      const referralWallet = referralRes.rows[0];

      if (Number(referralWallet.balance_cents) < amountCents) {
        throw new Error('Insufficient referral balance');
      }

      const referralNewBalance =
        Number(referralWallet.balance_cents) - amountCents;

      // Ledger: debit referral
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason, balance_after_cents)
        VALUES
          ($1, $2, 'REFERRAL_DEBIT', $3)
        `,
        [
          referralWallet.id,
          -amountCents,
          referralNewBalance
        ]
      );
    }

    /* =========================================================
       CREDIT REAL WALLET
    ========================================================= */
    const realNewBalance =
      Number(realWallet.balance_cents) + amountCents;

    await client.query(
      `
      INSERT INTO wallet_ledger
        (wallet_id, amount_cents, reason, balance_after_cents)
      VALUES
        ($1, $2, $3, $4)
      `,
      [
        realWallet.id,
        amountCents,
        source === 'REFERRAL'
          ? 'REFERRAL_TRANSFER'
          : 'BOT_TRANSFER',
        realNewBalance
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      transferred_cents: amountCents,
      new_balance: realNewBalance
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { transferToMainWallet };
