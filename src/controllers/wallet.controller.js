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
// RESET demo wallet (FULL RESET)
const resetDemoWallet = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const walletId = Number(req.params.id);

    await client.query('BEGIN');

    // 1️⃣ Verify demo wallet
    const { rows } = await client.query(
      `
      SELECT id
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

    // 2️⃣ Reset demo balance
    await client.query(
      `UPDATE wallets SET balance_cents=$1 WHERE id=$2`,
      [DEMO_BALANCE_CENTS, walletId]
    );

    // 3️⃣ DELETE ALL DEMO CYCLES (THIS IS THE MISSING PIECE)
    await client.query(
      `
      DELETE FROM cycles
      WHERE wallet_id = $1
      `,
      [walletId]
    );

    await client.query('COMMIT');

    res.json({
      balance_cents: DEMO_BALANCE_CENTS,
      cycles_cleared: true
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Demo reset failed:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};




/**
 * Transfer funds from REFERRAL wallet → REAL wallet
 */
const transferReferralToReal = async (req, res) => {
  const userId = req.user.id;
  const amount = Number(req.body.amount_cents);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: wallets } = await client.query(
      `
      SELECT id, type, balance_cents
      FROM wallets
      WHERE user_id = $1
        AND type IN ('REFERRAL', 'REAL')
      FOR UPDATE
      `,
      [userId]
    );

    const referralWallet = wallets.find(w => w.type === 'REFERRAL');
    const realWallet = wallets.find(w => w.type === 'REAL');

    if (!referralWallet || !realWallet) {
      throw new Error('Required wallets not found');
    }

    if (Number(referralWallet.balance_cents) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient referral balance' });
    }

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [amount, referralWallet.id]
    );

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [amount, realWallet.id]
    );

    await client.query(
      `
      INSERT INTO transactions (
        user_id,
        type,
        amount_cents,
        meta
      )
      VALUES ($1, 'referral_transfer', $2, jsonb_build_object(
        'from_wallet', 'REFERRAL',
        'to_wallet', 'REAL'
      ))
      `,
      [userId, amount]
    );

    await client.query('COMMIT');
    res.json({ message: 'Transfer successful' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Referral transfer error:', err);
    res.status(500).json({ message: 'Transfer failed' });
  } finally {
    client.release();
  }
};

module.exports = {
  getWallets,
  resetDemoWallet,
  transferReferralToReal
};
