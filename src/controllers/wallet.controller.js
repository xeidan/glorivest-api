'use strict';

const { pool } = require('../config/database');
const { resetDemoWallet, applyWalletDelta } = require('../services/wallet.service');

const DEMO_BALANCE_CENTS = 1_000_000;


// ======================================================
// GET USER WALLETS
// ======================================================

const getWallets = async (req, res) => {
  try {

    const { rows } = await pool.query(
      `
      SELECT id, code, type, balance_cents, status, demo_reset_at
      FROM wallets
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [req.user.id]
    );

    res.json(rows);

  } catch (err) {

    console.error('Get wallets failed:', err);
    res.status(500).json({ message: 'Server error' });

  }
};



// ======================================================
// RESET DEMO WALLET
// ======================================================

const resetDemoWalletController = async (req, res) => {

  const client = await pool.connect();

  try {

    const userId = req.user.id;

    await client.query('BEGIN');

    const newBalance = await resetDemoWallet(client, userId);

    // Cancel any running demo cycles
    await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED'
      WHERE wallet_id = (
        SELECT id
        FROM wallets
        WHERE user_id = $1
        AND type = 'DEMO'
      )
      `,
      [userId]
    );

    await client.query('COMMIT');

    res.json({
      balance_cents: newBalance
    });

  } catch (err) {

    await client.query('ROLLBACK');
    console.error('Demo reset failed:', err);

    res.status(500).json({
      message: 'Server error'
    });

  } finally {

    client.release();

  }
};



// ======================================================
// TRANSFER REFERRAL → REAL WALLET
// ======================================================

const transferReferralToReal = async (req, res) => {

  const userId = req.user.id;
  const amount = Number(req.body.amount_cents);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      message: 'Invalid amount'
    });
  }

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    // Lock wallets
    const { rows: wallets } = await client.query(
      `
      SELECT id, type, balance_cents
      FROM wallets
      WHERE user_id = $1
      AND type IN ('REFERRAL','REAL')
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

      return res.status(400).json({
        message: 'Insufficient referral balance'
      });
    }

    // --------------------------------------------------
    // Ledger-safe balance updates
    // --------------------------------------------------

    await applyWalletDelta(
      client,
      userId,
      'REFERRAL',
      -amount,
      'REFERRAL_TRANSFER_OUT'
    );

    await applyWalletDelta(
      client,
      userId,
      'REAL',
      amount,
      'REFERRAL_TRANSFER_IN'
    );

    // Transaction log
    await client.query(
      `
      INSERT INTO transactions (
        user_id,
        type,
        amount_cents,
        meta
      )
      VALUES (
        $1,
        'referral_transfer',
        $2,
        jsonb_build_object(
          'from_wallet','REFERRAL',
          'to_wallet','REAL'
        )
      )
      `,
      [userId, amount]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Transfer successful'
    });

  } catch (err) {

    await client.query('ROLLBACK');

    console.error('Referral transfer error:', err);

    res.status(500).json({
      message: 'Transfer failed'
    });

  } finally {

    client.release();

  }
};



// ======================================================

module.exports = {
  getWallets,
  resetDemoWalletController,
  transferReferralToReal
};