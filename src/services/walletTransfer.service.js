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

    // Lock REAL wallet
    const realRes = await client.query(
      `
      SELECT id
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

    const realWalletId = realRes.rows[0].id;

    if (source === 'REFERRAL') {

      // Lock REFERRAL wallet
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

      // Debit REFERRAL wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents - $1
        WHERE id = $2
        `,
        [amountCents, referralWallet.id]
      );

      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'REFERRAL_DEBIT')
        `,
        [referralWallet.id, -amountCents]
      );
    }

    // Credit REAL wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [amountCents, realWalletId]
    );

    await client.query(
      `
      INSERT INTO wallet_ledger
        (wallet_id, amount_cents, reason)
      VALUES
        ($1, $2, $3)
      `,
      [
        realWalletId,
        amountCents,
        source === 'REFERRAL'
          ? 'REFERRAL_TRANSFER'
          : 'BOT_TRANSFER'
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      transferred_cents: amountCents
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { transferToMainWallet };
