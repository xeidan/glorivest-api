'use strict';

const { pool } = require('../config/database');

const DEMO_BALANCE_CENTS = 1_000_000;

// -----------------------------
// GET ALL WALLETS (FOR DASHBOARD)
// -----------------------------
// src/controllers/wallet.controller.js
exports.getWallets = async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      code,
      type,
      balance_cents,
      status
    FROM wallets
    WHERE user_id=$1
    ORDER BY id ASC
    `,
    [req.user.id]
  );

  res.json(rows);
};


// -----------------------------
// RESET DEMO WALLET (BACKEND ONLY)
// -----------------------------
exports.resetDemoWallet = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const walletId = Number(req.params.walletId);

    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, balance_cents
      FROM wallets
      WHERE id=$1
        AND user_id=$2
        AND type='DEMO'
      LIMIT 1
      `,
      [walletId, userId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demo wallet not found' });
    }

    const oldBalance = Number(rows[0].balance_cents);

    if (oldBalance === DEMO_BALANCE_CENTS) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Demo already at default balance' });
    }

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = $1
      WHERE id = $2
      `,
      [DEMO_BALANCE_CENTS, walletId]
    );

    await client.query(
      `
      INSERT INTO ledger
        (user_id, wallet_id, type, amount_cents, balance_after_cents)
      VALUES
        ($1, $2, 'demo_reset', $3, $4)
      `,
      [
        userId,
        walletId,
        DEMO_BALANCE_CENTS - oldBalance,
        DEMO_BALANCE_CENTS
      ]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Demo wallet reset',
      balance_cents: DEMO_BALANCE_CENTS
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('resetDemoWallet error', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};
