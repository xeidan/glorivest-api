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
        return res.json({ transferred: 0 });
      }

      const totalProfit = cycles.reduce(
        (sum, c) => sum + Number(c.realized_profit_cents),
        0
      );

      const { rows } = await client.query(
        `
        SELECT id, balance_cents
        FROM wallets
        WHERE user_id = $1
          AND type = 'REAL'
        FOR UPDATE
        `,
        [userId]
      );

      if (!rows.length) {
        throw new Error('REAL wallet not found');
      }

      const wallet = rows[0];
      const newBalance =
        Number(wallet.balance_cents) + totalProfit;

      // Ledger insert (wallet auto-updated by trigger)
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason, balance_after_cents)
        VALUES
          ($1, $2, 'PROFIT_TRANSFER', $3)
        `,
        [wallet.id, totalProfit, newBalance]
      );

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
       REFERRAL TRANSFER
    ========================================================= */
    if (source === 'REFERRAL') {

      if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
        throw new Error('Invalid amount');
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
        throw new Error('Insufficient referral balance');
      }

      const referralNewBalance =
        Number(referralWallet.balance_cents) - amount_cents;

      // Debit referral wallet via ledger
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason, balance_after_cents)
        VALUES
          ($1, $2, 'REFERRAL_DEBIT', $3)
        `,
        [
          referralWallet.id,
          -amount_cents,
          referralNewBalance
        ]
      );

      // Lock REAL wallet
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
        throw new Error('REAL wallet not found');
      }

      const realWallet = realRes.rows[0];
      const realNewBalance =
        Number(realWallet.balance_cents) + amount_cents;

      // Credit REAL wallet via ledger
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, amount_cents, reason, balance_after_cents)
        VALUES
          ($1, $2, 'REFERRAL_TRANSFER', $3)
        `,
        [
          realWallet.id,
          amount_cents,
          realNewBalance
        ]
      );

      await client.query('COMMIT');

      return res.json({
        transferred: amount_cents,
        new_balance: realNewBalance
      });
    }

    throw new Error('Invalid source');

  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { transferProfits };
