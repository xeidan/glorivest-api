'use strict';

const { pool } = require('../config/database');

async function transferProfits(req, res) {
  const userId = req.user.id;
  const { amount_cents, source } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /* =========================================================
       BOT PROFIT TRANSFER (EXISTING LOGIC — UNCHANGED)
    ========================================================= */
    if (!source || source === 'BOT') {

      // 1. Lock completed cycles with profits
      const { rows: cycles } = await client.query(
        `
        SELECT id, realized_profit_cents
        FROM cycles
        WHERE user_id = $1
          AND status = 'COMPLETED'
          AND realized_profit_cents > 0
        FOR UPDATE
        `,
        [userId]
      );

      if (!cycles.length) {
        await client.query('ROLLBACK');
        return res.json({
          transferred: 0,
          message: 'No profits available'
        });
      }

      const totalProfit = cycles.reduce(
        (sum, c) => sum + Number(c.realized_profit_cents),
        0
      );

      // Lock REAL wallet
      const walletRes = await client.query(
        `
        SELECT id, balance_cents
        FROM wallets
        WHERE user_id = $1
          AND type = 'REAL'
        FOR UPDATE
        `,
        [userId]
      );

      if (!walletRes.rows.length) {
        throw new Error('REAL wallet not found');
      }

      const wallet = walletRes.rows[0];
      const newBalance =
        Number(wallet.balance_cents) + totalProfit;

      // Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1
        WHERE id = $2
        `,
        [newBalance, wallet.id]
      );

      // Ledger entry
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'PROFIT_TRANSFER')
        `,
        [wallet.id, totalProfit]
      );

      // Zero out profits
      await client.query(
        `
        UPDATE cycles
        SET realized_profit_cents = 0
        WHERE id = ANY($1::int[])
        `,
        [cycles.map(c => c.id)]
      );

      await client.query('COMMIT');

      return res.json({
        transferred: totalProfit,
        new_balance: newBalance
      });
    }

    /* =========================================================
       REFERRAL TRANSFER (NEW)
    ========================================================= */
    if (source === 'REFERRAL') {

      if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
        throw new Error('Invalid transfer amount');
      }

      // Lock user
      const userRes = await client.query(
        `
        SELECT referral_earnings_cents
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
      );

      if (!userRes.rowCount) {
        throw new Error('User not found');
      }

      const user = userRes.rows[0];

      if (Number(user.referral_earnings_cents || 0) < amount_cents) {
        throw new Error('Insufficient referral balance');
      }

      // Deduct referral balance
      await client.query(
        `
        UPDATE users
        SET referral_earnings_cents =
            referral_earnings_cents - $1
        WHERE id = $2
        `,
        [amount_cents, userId]
      );

      // Lock REAL wallet
      const walletRes = await client.query(
        `
        SELECT id, balance_cents
        FROM wallets
        WHERE user_id = $1
          AND type = 'REAL'
        FOR UPDATE
        `,
        [userId]
      );

      if (!walletRes.rowCount) {
        throw new Error('REAL wallet not found');
      }

      const wallet = walletRes.rows[0];
      const newBalance =
        Number(wallet.balance_cents) + amount_cents;

      // Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1
        WHERE id = $2
        `,
        [newBalance, wallet.id]
      );

      // Ledger entry
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'REFERRAL_TRANSFER')
        `,
        [wallet.id, amount_cents]
      );

      await client.query('COMMIT');

      return res.json({
        transferred: amount_cents,
        new_balance: newBalance
      });
    }

    throw new Error('Invalid transfer source');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { transferProfits };
