'use strict';

/**
 * Wallet Service
 *
 * Single financial engine for every wallet type.
 *
 * Supported wallet types:
 * - INVESTMENT
 * - REFERRAL
 * - DEMO
 *
 * Responsibilities:
 * - Credit wallet
 * - Debit wallet
 * - Lock funds
 * - Unlock funds
 * - Transfer between wallets
 * - Immutable ledger
 * - Transaction history
 */

async function getWalletForUpdate(
  client,
  userId,
  walletType = 'INVESTMENT'
) {
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
      AND account_type = $2
    LIMIT 1
    FOR UPDATE
    `,
    [userId, walletType]
  );

  if (!rows.length) {
    throw new Error(`${walletType} wallet not found`);
  }

  return rows[0];
}

async function applyWalletDelta(
  client,
  userId,
  walletType,
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

  const wallet = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  const currentBalance = Number(wallet.balance_cents);
  const newBalance = currentBalance + deltaCents;

  if (newBalance < 0) {
    throw new Error('Insufficient balance');
  }

  // Prevent duplicate processing
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
      wallet.id
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
      wallet.user_id,
      wallet.id,
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
      wallet.user_id,
      wallet.id,
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
 * Credit a wallet.
 */
async function creditWallet(
  client,
  userId,
  walletType,
  amountCents,
  type,
  reference = {}
) {
  if (amountCents <= 0) {
    throw new Error('Credit amount must be greater than zero');
  }

  return applyWalletDelta(
    client,
    userId,
    walletType,
    amountCents,
    type,
    reference
  );
}

/**
 * Debit a wallet.
 */
async function debitWallet(
  client,
  userId,
  walletType,
  amountCents,
  type,
  reference = {}
) {
  if (amountCents <= 0) {
    throw new Error('Debit amount must be greater than zero');
  }

  return applyWalletDelta(
    client,
    userId,
    walletType,
    -amountCents,
    type,
    reference
  );
}

/**
 * Lock funds inside a wallet.
 */
async function lockFunds(
  client,
  userId,
  walletType,
  amountCents
) {
  if (amountCents <= 0) {
    throw new Error('Invalid lock amount');
  }

  const wallet = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  if (wallet.balance_cents < amountCents) {
    throw new Error('Insufficient balance');
  }

  await client.query(
    `
    UPDATE accounts
    SET
      balance_cents = balance_cents - $1,
      locked_balance_cents = locked_balance_cents + $1
    WHERE id = $2
    `,
    [
      amountCents,
      wallet.id
    ]
  );
}

/**
 * Unlock previously locked funds.
 */
async function unlockFunds(
  client,
  userId,
  walletType,
  amountCents
) {
  if (amountCents <= 0) {
    throw new Error('Invalid unlock amount');
  }

  const wallet = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  if (wallet.locked_balance_cents < amountCents) {
    throw new Error('Locked balance exceeded');
  }

  await client.query(
    `
    UPDATE accounts
    SET
      balance_cents = balance_cents + $1,
      locked_balance_cents = locked_balance_cents - $1
    WHERE id = $2
    `,
    [
      amountCents,
      wallet.id
    ]
  );
}

/**
 * Transfer funds between wallets.
 */
async function transferBetweenWallets(
  client,
  userId,
  fromWallet,
  toWallet,
  amountCents,
  reference = {}
) {
  if (fromWallet === toWallet) {
    throw new Error('Cannot transfer to same wallet');
  }

  if (amountCents <= 0) {
    throw new Error('Invalid transfer amount');
  }

  await debitWallet(
    client,
    userId,
    fromWallet,
    amountCents,
    'WALLET_TRANSFER_OUT',
    {
      ...reference,
      meta: {
        from: fromWallet,
        to: toWallet
      }
    }
  );

  await creditWallet(
    client,
    userId,
    toWallet,
    amountCents,
    'WALLET_TRANSFER_IN',
    {
      ...reference,
      meta: {
        from: fromWallet,
        to: toWallet
      }
    }
  );
}

/**
 * Reset a wallet to a fixed balance.
 * Primarily used for DEMO wallets.
 */
async function resetWallet(
  client,
  userId,
  walletType,
  balanceCents
) {
  const wallet = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  await client.query(
    `
    UPDATE accounts
    SET
      balance_cents = $1,
      locked_balance_cents = 0
    WHERE id = $2
    `,
    [
      balanceCents,
      wallet.id
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
      meta
    )
    VALUES
    ($1,$2,'WALLET_RESET',$3,$3,$4)
    `,
    [
      wallet.user_id,
      wallet.id,
      balanceCents,
      {
        walletType
      }
    ]
  );

  return balanceCents;
}

module.exports = {
  getWalletForUpdate,
  applyWalletDelta,
  creditWallet,
  debitWallet,
  lockFunds,
  unlockFunds,
  transferBetweenWallets,
  resetWallet
};