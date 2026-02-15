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

    /* =========================================================
       REFERRAL FLOW (IF APPLICABLE)
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

      /* ---------- Debit REFERRAL wallet ---------- */

      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents - $1
        WHERE id = $2
        `,
        [amountCents, referralWallet.id]
      );

      const referralUpdated = await client.query(
        `SELECT balance_cents FROM wallets WHERE id = $1`,
        [referralWallet.id]
      );

      const referralNewBalance =
        Number(referralUpdated.rows[0].balance_cents);

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

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [amountCents, realWalletId]
    );

    const realUpdated = await client.query(
      `SELECT balance_cents FROM wallets WHERE id = $1`,
      [realWalletId]
    );

    const realNewBalance =
      Number(realUpdated.rows[0].balance_cents);

    await client.query(
      `
      INSERT INTO wallet_ledger
        (wallet_id, amount_cents, reason, balance_after_cents)
      VALUES
        ($1, $2, $3, $4)
      `,
      [
        realWalletId,
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
