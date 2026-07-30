'use strict';

/**
 * Account Engine
 *
 * Single source of truth for all account operations.
 *
 * Supported account types:
 * - INVESTMENT
 * - REFERRAL
 */

async function getAccount(client, userId, accountType = 'INVESTMENT') {
  const { rows } = await client.query(
    `
    SELECT *
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
  accountType = 'INVESTMENT'
) {
  const { rows } = await client.query(
    `
    SELECT *
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
  if (lockedBalanceCents < 0) {
    throw new Error('Locked balance cannot be negative');
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
  if (amountCents <= 0) {
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
  if (amountCents <= 0) {
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

async function lockFunds(
  client,
  userId,
  amountCents
) {
  if (amountCents <= 0) {
    throw new Error('Invalid lock amount');
  }

  const account =
    await getAccountForUpdate(
      client,
      userId,
      'INVESTMENT'
    );

  const balance =
    Number(account.balance_cents);

  const locked =
    Number(account.locked_balance_cents);

  const available =
    balance - locked;

  if (available < amountCents) {
    throw new Error('Insufficient available balance');
  }

  await updateLockedBalance(
    client,
    account.id,
    locked + amountCents
  );

  return {
    balance,
    locked: locked + amountCents,
    available: balance - (locked + amountCents)
  };
}

async function unlockFunds(
  client,
  userId,
  amountCents
) {
  if (amountCents <= 0) {
    throw new Error('Invalid unlock amount');
  }

  const account =
    await getAccountForUpdate(
      client,
      userId,
      'INVESTMENT'
    );

  const locked =
    Number(account.locked_balance_cents);

  if (locked < amountCents) {
    throw new Error('Invalid unlock amount');
  }

  await updateLockedBalance(
    client,
    account.id,
    locked - amountCents
  );

  return {
    balance: Number(account.balance_cents),
    locked: locked - amountCents,
    available:
      Number(account.balance_cents) -
      (locked - amountCents)
  };
}

async function transfer(
  client,
  userId,
  fromAccountType,
  toAccountType,
  amountCents
) {
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
}

module.exports = {
  getAccount,
  getAccountForUpdate,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  transfer
};