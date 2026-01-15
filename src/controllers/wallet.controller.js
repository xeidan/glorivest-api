'use strict';

const { pool } = require('../config/database');

const DEMO_BALANCE_CENTS = 1_000_000;

// GET wallets
const getWallets = async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT id, code, type, balance_cents, status
    FROM wallets
    WHERE user_id = $1
    ORDER BY created_at ASC
    `,
    [req.user.id]
  );

  res.json(rows);
};

// RESET demo wallet
const resetDemoWallet = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const walletId = Number(req.params.id);

    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT balance_cents
      FROM wallets
      WHERE id=$1 AND user_id=$2 AND type='DEMO'
      LIMIT 1
      `,
      [walletId, userId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demo wallet not found' });
    }

    await client.query(
      `UPDATE wallets SET balance_cents=$1 WHERE id=$2`,
      [DEMO_BALANCE_CENTS, walletId]
    );

    await client.query('COMMIT');

    res.json({ balance_cents: DEMO_BALANCE_CENTS });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

module.exports = {
  getWallets,
  resetDemoWallet
};
