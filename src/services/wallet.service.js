'use strict';

/**
 * Account / Wallet Financial Service
 *
 * Database source of truth:
 *   accounts
 *
 * Supported account types:
 *   DEMO
 *   LIVE
 *   REFERRAL
 *
 * The frontend may call these "wallets",
 * but the database uses accounts.
 *
 * Financial values are stored in cents.
 *
 * Responsibilities:
 * - Read and lock accounts
 * - Credit accounts
 * - Debit accounts
 * - Lock funds
 * - Unlock funds
 * - Transfer between accounts
 * - Reset DEMO account
 * - Write ledger entries
 * - Write transaction history
 */


// ======================================================
// GET ACCOUNT FOR UPDATE
// ======================================================

async function getWalletForUpdate(
  client,
  userId,
  walletType
) {
  if (!walletType) {
    throw new Error('accountType is required');
  }

  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      account_type,
      balance_cents,
      locked_balance_cents,
      profit_cents,
      status
    FROM accounts
    WHERE user_id = $1
      AND account_type = $2
    LIMIT 1
    FOR UPDATE
    `,
    [userId, walletType]
  );

  if (!rows.length) {
    throw new Error(`${walletType} account not found`);
  }

  return rows[0];
}


// ======================================================
// APPLY BALANCE CHANGE
// ======================================================

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

  const account = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  /*
   * Idempotency check must happen BEFORE
   * calculating/updating the balance.
   */
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
      return Number(account.balance_cents);
    }
  }

  const currentBalance =
    Number(account.balance_cents);

  const newBalance =
    currentBalance + deltaCents;

  if (newBalance < 0) {
    throw new Error('Insufficient balance');
  }

  /*
   * Update account balance.
   */
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

  /*
   * Immutable ledger entry.
   */
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

  /*
   * Transaction history.
   */
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


// ======================================================
// CREDIT ACCOUNT
// ======================================================

async function creditWallet(
  client,
  userId,
  walletType,
  amountCents,
  type,
  reference = {}
) {
  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error(
      'Credit amount must be greater than zero'
    );
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


// ======================================================
// DEBIT ACCOUNT
// ======================================================

async function debitWallet(
  client,
  userId,
  walletType,
  amountCents,
  type,
  reference = {}
) {
  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error(
      'Debit amount must be greater than zero'
    );
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


// ======================================================
// LOCK FUNDS
// ======================================================

async function lockFunds(
  client,
  userId,
  walletType,
  amountCents
) {
  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error('Invalid lock amount');
  }

  const account = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  const balance =
    Number(account.balance_cents);

  const locked =
    Number(account.locked_balance_cents);

  /*
   * Available funds are:
   *
   * balance - locked
   */
  const available =
    balance - locked;

  if (available < amountCents) {
    throw new Error(
      `Insufficient available ${walletType} balance`
    );
  }

  const newLocked =
    locked + amountCents;

  await client.query(
    `
    UPDATE accounts
    SET locked_balance_cents = $1
    WHERE id = $2
    `,
    [
      newLocked,
      account.id
    ]
  );

  return {
    accountId: account.id,
    balance,
    locked: newLocked,
    available: balance - newLocked
  };
}


// ======================================================
// UNLOCK FUNDS
// ======================================================

async function unlockFunds(
  client,
  userId,
  walletType,
  amountCents
) {
  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error('Invalid unlock amount');
  }

  const account = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  const locked =
    Number(account.locked_balance_cents);

  if (locked < amountCents) {
    throw new Error(
      'Locked balance exceeded'
    );
  }

  const newLocked =
    locked - amountCents;

  await client.query(
    `
    UPDATE accounts
    SET locked_balance_cents = $1
    WHERE id = $2
    `,
    [
      newLocked,
      account.id
    ]
  );

  return {
    accountId: account.id,
    balance: Number(account.balance_cents),
    locked: newLocked,
    available:
      Number(account.balance_cents) -
      newLocked
  };
}


// ======================================================
// TRANSFER BETWEEN ACCOUNTS
// ======================================================

async function transferBetweenWallets(
  client,
  userId,
  fromWallet,
  toWallet,
  amountCents,
  reference = {}
) {
  if (fromWallet === toWallet) {
    throw new Error(
      'Cannot transfer to same account'
    );
  }

  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error(
      'Invalid transfer amount'
    );
  }

  /*
   * Debit source.
   */
  await debitWallet(
    client,
    userId,
    fromWallet,
    amountCents,
    'WALLET_TRANSFER_OUT',
    {
      ...reference,
      meta: {
        ...(reference.meta || {}),
        from_account: fromWallet,
        to_account: toWallet
      }
    }
  );

  /*
   * Credit destination.
   */
  await creditWallet(
    client,
    userId,
    toWallet,
    amountCents,
    'WALLET_TRANSFER_IN',
    {
      ...reference,
      meta: {
        ...(reference.meta || {}),
        from_account: fromWallet,
        to_account: toWallet
      }
    }
  );

  return {
    amountCents,
    fromWallet,
    toWallet
  };
}


// ======================================================
// RESET ACCOUNT
// ======================================================

async function resetWallet(
  client,
  userId,
  walletType,
  balanceCents
) {
  if (
    !Number.isInteger(balanceCents) ||
    balanceCents < 0
  ) {
    throw new Error(
      'Invalid reset balance'
    );
  }

  const account = await getWalletForUpdate(
    client,
    userId,
    walletType
  );

  /*
   * Reset balance and clear locked capital.
   */
  await client.query(
    `
    UPDATE accounts
    SET
      balance_cents = $1,
      locked_balance_cents = 0,
      profit_cents = 0
    WHERE id = $2
    `,
    [
      balanceCents,
      account.id
    ]
  );

  /*
   * Record reset in transaction history.
   */
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
      account.user_id,
      account.id,
      balanceCents,
      {
        walletType,
        accountType: walletType,
        resetBalanceCents: balanceCents
      }
    ]
  );

  return balanceCents;
}


// ======================================================
// EXPORTS
// ======================================================

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