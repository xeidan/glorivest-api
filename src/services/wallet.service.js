'use strict';

/**
 * Financial engine.
 *
 * This service now operates ONLY on INVESTMENT accounts.
 * Referral accounts will use referralWallet.service.js.
 */

async function getInvestmentAccountForUpdate(client, userId) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      account_type,
      balance_cents,
      locked_balance_cents
    FROM accounts
    WHERE user_id = $1
      AND account_type = 'INVESTMENT'
    LIMIT 1
    FOR UPDATE
    `,
    [userId]
  );

  if (!rows.length) {
    throw new Error('Investment account not found');
  }

  return rows[0];
}

async function applyWalletDelta(
  client,
  userId,
  deltaCents,
  type,
  reference = {}
) {
  if (!Number.isInteger(deltaCents)) {
    throw new Error('deltaCents must be an integer');
  }

  if (deltaCents === 0) {
    throw new Error('deltaCents cannot be zero');
  }

  const account = await getInvestmentAccountForUpdate(
    client,
    userId
  );

  const currentBalance = Number(account.balance_cents);
  const newBalance = currentBalance + deltaCents;

  if (newBalance < 0) {
    throw new Error('Insufficient balance');
  }

  // Idempotency protection
  if (reference.idempotencyKey) {
    const { rows } = await client.query(
      `
      SELECT id
      FROM ledger
      WHERE idempotency_key = $1
      LIMIT 1
      `,
      [reference.idempotencyKey]
    );

    if (rows.length) {
      return newBalance;
    }
  }

  // Update balance
  await client.query(
    `
    UPDATE accounts
    SET
      balance_cents = $1
    WHERE id = $2
    `,
    [
      newBalance,
      account.id
    ]
  );

  // Immutable ledger
  await client.query(
    `
    INSERT INTO ledger
    (
      user_id,
      account_id,
      type,
      amount_cents,
      ref_type,
      ref_id,
      idempotency_key
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      account.user_id,
      account.id,
      type,
      deltaCents,
      reference.refType ?? null,
      reference.refId ?? null,
      reference.idempotencyKey ?? null
    ]
  );

  // User transaction history
  await client.query(
    `
    INSERT INTO transactions
    (
      user_id,
      account_id,
      type,
      amount_cents,
      balance_after_cents,
      reference,
      meta
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      account.user_id,
      account.id,
      type,
      deltaCents,
      newBalance,
      reference.reference ?? null,
      reference.meta ?? {}
    ]
  );

  return newBalance;
}

/**
 * Placeholder compatibility functions.
 * These will be migrated after the new account engine
 * is fully adopted.
 */

async function resetDemoWallet() {
  throw new Error('resetDemoWallet has not been migrated yet.');
}

async function creditReferralWallet() {
  throw new Error('creditReferralWallet has not been migrated yet.');
}

module.exports = {
  applyWalletDelta,
  getInvestmentAccountForUpdate,
  resetDemoWallet,
  creditReferralWallet
};