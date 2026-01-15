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



// Transfer referral funds to real wallet

const { pool } = require('../config/database');

/**
 * Transfer funds from REFERRAL wallet → REAL wallet
 */
const transferReferralToReal = async (req, res) => {
  const userId = req.user.id;
  const { amount_cents } = req.body;

  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock both wallets
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
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Required wallets missing' });
    }

    if (Number(referralWallet.balance_cents) < amount_cents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient referral balance' });
    }

    // Deduct from referral
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [amount_cents, referralWallet.id]
    );

    // Credit real wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id = $2
      `,
      [amount_cents, realWallet.id]
    );

    // Optional: record internal transaction
    await client.query(
      `
      INSERT INTO transactions (
        user_id,
        type,
        amount_cents,
        meta
      )
      VALUES ($1, 'REFERRAL_TRANSFER', $2, $3)
      `,
      [
        userId,
        amount_cents,
        JSON.stringify({
          from: 'REFERRAL',
          to: 'REAL'
        })
      ]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Referral funds transferred',
      amount_cents
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('transferReferralToReal error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};


module.exports = {
  getWallets,
  resetDemoWallet,
  transferReferralToReal
};
