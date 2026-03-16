// src/services/wallet.service.js
'use strict';

const { pool } = require('../config/database');

/**
 * Generate deterministic wallet code
 */
function makeWalletCode(userId, type) {
  return `GV${userId}-${type}`;
}

/**
 * 🔒 THE ONLY FUNCTION ALLOWED TO MUTATE MONEY
 * All credits/debits must go through here.
 */
async function applyWalletDelta(
  client,
  userId,
  type,
  deltaCents,
  reason,
  reference = null
) {
  if (!Number.isInteger(deltaCents) || deltaCents === 0) {
    throw new Error('Invalid wallet delta');
  }

  const { rows } = await client.query(
    `
    SELECT id, balance_cents
    FROM wallets
    WHERE user_id = $1
      AND type = $2
    FOR UPDATE
    `,
    [userId, type]
  );

  if (!rows.length) {
    throw new Error(`${type} wallet not found`);
  }

  const walletId = rows[0].id;
  const currentBalance = Number(rows[0].balance_cents);
  const newBalance = currentBalance + deltaCents;

  if (newBalance < 0) {
    throw new Error('Insufficient balance');
  }

  const refType = reference?.refType || null;
  const refId = reference?.refId || null;

  await client.query(
    `
    INSERT INTO wallet_ledger
      (wallet_id,
       amount_cents,
       reason,
       balance_after_cents,
       ref_type,
       ref_id)
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [
      walletId,
      deltaCents,
      reason,
      newBalance,
      refType,
      refId
    ]
  );

  await client.query(
    `
    UPDATE wallets
    SET balance_cents = $1,
        updated_at = NOW()
    WHERE id = $2
    `,
    [newBalance, walletId]
  );

  return newBalance;
}



/**
 * Ensure REAL, DEMO, REFERRAL wallets exist.
 * Safe to call inside transaction.
 */
async function ensureUserWallets(client, userId) {
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
}

/**
 * Reset demo wallet to 1,000,000 cents
 */
async function resetDemoWallet(client, userId) {
  const { rows } = await client.query(
    `
    SELECT balance_cents
    FROM wallets
    WHERE user_id = $1
      AND type = 'DEMO'
    FOR UPDATE
    `,
    [userId]
  );

  if (!rows.length) {
    throw new Error('Demo wallet not found');
  }

  const current = Number(rows[0].balance_cents);
  const target = 1000000;
  const delta = target - current;

  if (delta === 0) return target;

  return applyWalletDelta(
    client,
    userId,
    'DEMO',
    delta,
    'DEMO_RESET'
  );
}

/**
 * Credit referral wallet
 */
async function creditReferralWallet(client, userId, cents) {
  return applyWalletDelta(
    client,
    userId,
    'REFERRAL',
    cents,
    'REFERRAL_REWARD'
  );
}

module.exports = {
  ensureUserWallets,
  resetDemoWallet,
  creditReferralWallet,
  applyWalletDelta
};
