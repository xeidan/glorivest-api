'use strict';

const { pool } = require('../config/database');

async function transferProfits(req, res) {
  const userId = req.user.id;
  const { amount_cents, source } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /* =========================================================
       BOT PROFIT TRANSFER
    ========================================================= */
    if (!source || source === 'BOT') {

      // Lock completed profitable cycles
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
        SELECT id
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

      const realWalletId = walletRes.rows[0].id;

      // Atomic increment
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [totalProfit, realWalletId]
      );

      // Ledger entry
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'PROFIT_TRANSFER')
        `,
        [realWalletId, totalProfit]
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

      // Fetch updated balance
      const updated = await client.query(
        `SELECT balance_cents FROM wallets WHERE id = $1`,
        [realWalletId]
      );

      await client.query('COMMIT');

      return res.json({
        transferred: totalProfit,
        new_balance: Number(updated.rows[0].balance_cents)
      });
    }

    /* =========================================================
       REFERRAL WALLET TRANSFER
    ========================================================= */
    if (source === 'REFERRAL') {

      if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Invalid transfer amount'
        });
      }

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

      if (Number(referralWallet.balance_cents) < amount_cents) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Insufficient referral balance'
        });
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
        throw new Error('REAL wallet not found');
      }

      const realWalletId = realRes.rows[0].id;

      // Debit REFERRAL wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents - $1
        WHERE id = $2
        `,
        [amount_cents, referralWallet.id]
      );

      // Credit REAL wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE id = $2
        `,
        [amount_cents, realWalletId]
      );

      // Ledger: referral debit
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'REFERRAL_DEBIT')
        `,
        [referralWallet.id, -amount_cents]
      );

      // Ledger: real credit
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason)
        VALUES
          ($1, $2, 'REFERRAL_TRANSFER')
        `,
        [realWalletId, amount_cents]
      );

      // Fetch updated REAL balance
      const updated = await client.query(
        `SELECT balance_cents FROM wallets WHERE id = $1`,
        [realWalletId]
      );

      await client.query('COMMIT');

      return res.json({
        transferred: amount_cents,
        new_balance: Number(updated.rows[0].balance_cents)
      });
    }

    await client.query('ROLLBACK');
    return res.status(400).json({
      error: 'Invalid transfer source'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Transfer failed' });
  } finally {
    client.release();
  }
}

module.exports = { transferProfits };
