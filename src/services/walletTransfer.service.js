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

    // Lock user row
    const userRes = await client.query(
      `SELECT id,
              COALESCE(referral_earnings_cents, 0) AS referral_earnings_cents
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (!userRes.rowCount) {
      throw new Error('User not found');
    }

    const user = userRes.rows[0];

    // Deduct referral balance if source is REFERRAL
    if (source === 'REFERRAL') {
      if (Number(user.referral_earnings_cents) < amountCents) {
        throw new Error('Insufficient referral balance');
      }

      await client.query(
        `UPDATE users
         SET referral_earnings_cents = referral_earnings_cents - $1
         WHERE id = $2`,
        [amountCents, userId]
      );
    }

    // Lock REAL wallet
    const walletRes = await client.query(
      `SELECT id, balance_cents
       FROM wallets
       WHERE user_id = $1
         AND type = 'REAL'
       FOR UPDATE`,
      [userId]
    );

    if (!walletRes.rowCount) {
      throw new Error('Main wallet not found');
    }

    const wallet = walletRes.rows[0];

    // Credit wallet
    await client.query(
      `UPDATE wallets
       SET balance_cents = balance_cents + $1
       WHERE id = $2`,
      [amountCents, wallet.id]
    );

    // Ledger entry
    await client.query(
      `INSERT INTO wallet_ledger
       (user_id, wallet_id, amount_cents, type, source, created_at)
       VALUES ($1, $2, $3, 'CREDIT', $4, NOW())`,
      [userId, wallet.id, amountCents, source]
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
