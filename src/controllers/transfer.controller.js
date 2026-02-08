// src/controllers/transfer.controller.js
'use strict';

const { pool } = require('../config/database');

async function transferProfits(req, res) {
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    // 2. Lock main wallet
    const walletRes = await client.query(
      `
      SELECT id, balance_cents
      FROM wallets
      WHERE user_id = $1
        AND type = 'MAIN'
      FOR UPDATE
      `,
      [userId]
    );

    if (!walletRes.rows.length) {
      throw new Error('Main wallet not found');
    }

    const wallet = walletRes.rows[0];
    const newBalance = Number(wallet.balance_cents) + totalProfit;

    // 3. Credit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = $1
      WHERE id = $2
      `,
      [newBalance, wallet.id]
    );

    // 4. Ledger entry (single consolidated record)
    await client.query(
      `
      INSERT INTO wallet_ledger
        (wallet_id, type, reason, amount_cents, balance_after_cents)
      VALUES
        ($1, 'CREDIT', 'PROFIT_TRANSFER', $2, $3)
      `,
      [wallet.id, totalProfit, newBalance]
    );

    // 5. Zero out profits (idempotent)
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

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Transfer failed' });
  } finally {
    client.release();
  }
}

module.exports = { transferProfits };
