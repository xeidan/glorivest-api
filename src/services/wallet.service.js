// src/services/wallet.service.js
'use strict';

const { pool } = require('../config/database');

/**
 * Ensure user has REAL, DEMO, and REFERRAL wallets.
 * Safe to call multiple times.
 */
async function ensureUserWallets(userId) {
  await pool.query(
    `
    INSERT INTO wallets (user_id, type, balance_cents, status)
    VALUES
      ($1, 'REAL', 0, 'active'),
      ($1, 'DEMO', 1000000, 'active'),
      ($1, 'REFERRAL', 0, 'active')
    ON CONFLICT (user_id, type) DO NOTHING
    `,
    [userId]
  );
}

/**
 * Reset demo wallet to $10,000
 */
async function resetDemoWallet(userId, walletId) {
  const { rows } = await pool.query(
    `SELECT id FROM wallets WHERE id=$1 AND user_id=$2 AND type='DEMO'`,
    [walletId, userId]
  );

  if (!rows.length) {
    throw new Error('Invalid demo wallet');
  }

  await pool.query(
    `UPDATE wallets SET balance_cents=1000000 WHERE id=$1`,
    [walletId]
  );
}

/**
 * Credit referral wallet
 */
async function creditReferralWallet(userId, cents) {
  await pool.query(
    `
    UPDATE wallets
    SET balance_cents = balance_cents + $1
    WHERE user_id=$2 AND type='REFERRAL'
    `,
    [cents, userId]
  );
}

module.exports = {
  ensureUserWallets,
  resetDemoWallet,
  creditReferralWallet
};
