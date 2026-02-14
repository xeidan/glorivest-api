// walletTransfer.service.js

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

    // 1️⃣ Lock user
    const userRes = await client.query(
      `SELECT id, referral_earnings_cents
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (!userRes.rowCount) {
      throw new Error('User not found');
    }

    const user = userRes.rows[0];

    // 2️⃣ Determine source balance
    if (source === 'REFERRAL') {
      if (user.referral_earnings_cents < amountCents) {
        throw new Error('Insufficient referral balance');
      }

      await client.query(
        `UPDATE users
         SET referral_earnings_cents = referral_earnings_cents - $1
         WHERE id = $2`,
        [amountCents, userId]
      );
    }

    if (source === 'BOT') {
      // BOT transfers should already be validated by cycle settlement
      // so nothing deducted here
    }

    // 3️⃣ Credit main wallet
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

    await client.query(
      `UPDATE wallets
       SET balance_cents = balance_cents + $1
       WHERE id = $2`,
      [amountCents, wallet.id]
    );

    // 4️⃣ Insert ledger entry
    await client.query(
      `INSERT INTO wallet_ledger
       (user_id, wallet_id, amount_cents, type, source, created_at)
       VALUES ($1, $2, $3, 'CREDIT', $4, NOW())`,
      [userId, wallet.id, amountCents, source]
    );

    await client.query('COMMIT');

    return {
      success: true,
      transferred: amountCents
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { transferToMainWallet };
