'use strict';

/**
 * Financial engine.
 *
 * NOTE:
 * The file is still called wallet.service.js so existing imports
 * continue to work during the migration.
 */

async function getAccountForUpdate(client, userId) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      balance_cents
    FROM accounts
    WHERE user_id = $1
    LIMIT 1
    FOR UPDATE
    `,
    [userId]
  );

  if (!rows.length) {
    throw new Error('Account not found');
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

  const account = await getAccountForUpdate(client, userId);

  const currentBalance = Number(account.balance_cents);
  const newBalance = currentBalance + deltaCents;

  if (newBalance < 0) {
    throw new Error('Insufficient balance');
  }

  // Prevent duplicate balance mutations
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

  await client.query(
    `
    UPDATE accounts
    SET balance_cents = $1
    WHERE id = $2
    `,
    [
      newBalance,
      account.id
    ]
  );

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

/*
 * Temporary compatibility functions.
 * These will be rewritten later.
 */

async function resetDemoWallet() {
  throw new Error('resetDemoWallet has not been migrated yet.');
}

async function creditReferralWallet() {
  throw new Error('creditReferralWallet has not been migrated yet.');
}

module.exports = {
  applyWalletDelta,
  resetDemoWallet,
  creditReferralWallet
};