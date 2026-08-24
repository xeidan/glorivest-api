'use strict';

/**
 * Account Engine
 *
 * Supported account types:
 * - DEMO      → independent simulated trading balance
 * - LIVE      → real user funds
 * - REFERRAL  → referral earnings kept separate from LIVE
 *
 * Account balances are never mixed.
 */

async function getAccount(
  client,
  userId,
  accountType
) {
  if (!accountType) {
    throw new Error('accountType is required');
  }

  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      tier_id,
      account_code,
      status,
      balance_cents,
      profit_cents,
      bot_started_at,
      bot_ends_at,
      created_at,
      account_type,
      locked_balance_cents
    FROM accounts
    WHERE user_id = $1
      AND account_type = $2
    LIMIT 1
    `,
    [userId, accountType]
  );

  if (!rows.length) {
    throw new Error(`${accountType} account not found`);
  }

  return rows[0];
}

async function getAccountForUpdate(
  client,
  userId,
  accountType
) {
  if (!accountType) {
    throw new Error('accountType is required');
  }

  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      tier_id,
      account_code,
      status,
      balance_cents,
      profit_cents,
      bot_started_at,
      bot_ends_at,
      created_at,
      account_type,
      locked_balance_cents
    FROM accounts
    WHERE user_id = $1
      AND account_type = $2
    LIMIT 1
    FOR UPDATE
    `,
    [userId, accountType]
  );

  if (!rows.length) {
    throw new Error(`${accountType} account not found`);
  }

  return rows[0];
}

async function updateBalance(
  client,
  accountId,
  balanceCents
) {
  if (!Number.isInteger(balanceCents)) {
    throw new Error('balanceCents must be an integer');
  }

  if (balanceCents < 0) {
    throw new Error('Balance cannot be negative');
  }

  await client.query(
    `
    UPDATE accounts
    SET balance_cents = $1
    WHERE id = $2
    `,
    [
      balanceCents,
      accountId
    ]
  );
}

async function updateLockedBalance(
  client,
  accountId,
  lockedBalanceCents
) {
  if (!Number.isInteger(lockedBalanceCents)) {
    throw new Error(
      'lockedBalanceCents must be an integer'
    );
  }

  if (lockedBalanceCents < 0) {
    throw new Error(
      'Locked balance cannot be negative'
    );
  }

  await client.query(
    `
    UPDATE accounts
    SET locked_balance_cents = $1
    WHERE id = $2
    `,
    [
      lockedBalanceCents,
      accountId
    ]
  );
}

async function credit(
  client,
  userId,
  accountType,
  amountCents
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Invalid credit amount');
  }

  const account = await getAccountForUpdate(
    client,
    userId,
    accountType
  );

  const newBalance =
    Number(account.balance_cents) + amountCents;

  await updateBalance(
    client,
    account.id,
    newBalance
  );

  return newBalance;
}

async function debit(
  client,
  userId,
  accountType,
  amountCents
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Invalid debit amount');
  }

  const account = await getAccountForUpdate(
    client,
    userId,
    accountType
  );

  const currentBalance =
    Number(account.balance_cents);

  if (currentBalance < amountCents) {
    throw new Error('Insufficient balance');
  }

  const newBalance =
    currentBalance - amountCents;

  await updateBalance(
    client,
    account.id,
    newBalance
  );

  return newBalance;
}

/**
 * Lock LIVE funds for a cycle.
 *
 * IMPORTANT:
 * balance_cents remains the user's total LIVE balance.
 * locked_balance_cents represents capital committed
 * to active cycles.
 *
 * Available:
 * balance - locked
 */
async function lockFunds(
  client,
  userId,
  amountCents
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Invalid lock amount');
  }

  const account = await getAccountForUpdate(
    client,
    userId,
    'LIVE'
  );

  const balance =
    Number(account.balance_cents);

  const locked =
    Number(account.locked_balance_cents);

  const available =
    balance - locked;

  if (available < amountCents) {
    throw new Error(
      'Insufficient available LIVE balance'
    );
  }

  const newLocked =
    locked + amountCents;

  await updateLockedBalance(
    client,
    account.id,
    newLocked
  );

  return {
    accountId: account.id,
    balance,
    locked: newLocked,
    available: balance - newLocked
  };
}

/**
 * Unlock LIVE funds after a cycle completes
 * or is forfeited.
 */
async function unlockFunds(
  client,
  userId,
  amountCents
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Invalid unlock amount');
  }

  const account = await getAccountForUpdate(
    client,
    userId,
    'LIVE'
  );

  const locked =
    Number(account.locked_balance_cents);

  if (locked < amountCents) {
    throw new Error(
      'Invalid unlock amount'
    );
  }

  const newLocked =
    locked - amountCents;

  await updateLockedBalance(
    client,
    account.id,
    newLocked
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

/**
 * Transfer funds between account types.
 *
 * Example:
 * REFERRAL → LIVE
 *
 * This is the only way referral earnings
 * become part of the LIVE balance.
 */
async function transfer(
  client,
  userId,
  fromAccountType,
  toAccountType,
  amountCents
) {
  if (
    !fromAccountType ||
    !toAccountType
  ) {
    throw new Error(
      'Source and destination account types are required'
    );
  }

  if (
    fromAccountType === toAccountType
  ) {
    throw new Error(
      'Source and destination accounts must be different'
    );
  }

  if (
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error('Invalid transfer amount');
  }

  await debit(
    client,
    userId,
    fromAccountType,
    amountCents
  );

  await credit(
    client,
    userId,
    toAccountType,
    amountCents
  );

  return {
    amountCents,
    fromAccountType,
    toAccountType
  };
}

module.exports = {
  getAccount,
  getAccountForUpdate,
  updateBalance,
  updateLockedBalance,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  transfer
};