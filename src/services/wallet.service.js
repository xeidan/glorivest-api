'use strict';

const { pool } = require('../config/database');

/**
 * Generate deterministic wallet code
 * Example: GV2-REAL, GV2-DEMO, GV2-REF
 */
function makeWalletCode(userId, type) {
  return `GV${userId}-${type}`;
}

/**
 * Ensure user has REAL, DEMO, and REFERRAL wallets.
 * SAFE to call multiple times.
 */
async function ensureUserWallets(userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      INSERT INTO wallets (user_id, code, type, balance_cents, status)
      VALUES
        ($1, $2, 'REAL', 0, 'active'),
        ($1, $3, 'DEMO', 1000000, 'active'),
        ($1, $4, 'REFERRAL', 0, 'active')
      ON CONFLICT (user_id, type) DO NOTHING
      `,
      [
        userId,
        makeWalletCode(userId, 'REAL'),
        makeWalletCode(userId, 'DEMO'),
        makeWalletCode(userId, 'REFERRAL')
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reset demo wallet to $10,000
 */
async function resetDemoWallet(userId, walletId) {
  const { rowCount } = await pool.query(
    `
    UPDATE wallets
    SET balance_cents = 1000000
    WHERE id = $1
      AND user_id = $2
      AND type = 'DEMO'
    `,
    [walletId, userId]
  );

  if (!rowCount) {
    throw new Error('Invalid demo wallet');
  }
}

/**
 * Credit referral wallet
 */
async function creditReferralWallet(userId, cents) {
  await pool.query(
    `
    UPDATE wallets
    SET balance_cents = balance_cents + $1
    WHERE user_id = $2
      AND type = 'REFERRAL'
    `,
    [cents, userId]
  );
}

module.exports = {
  ensureUserWallets,
  resetDemoWallet,
  creditReferralWallet
};
