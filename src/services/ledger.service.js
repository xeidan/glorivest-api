'use strict';

async function postTransaction(
  {
    userId,
    accountId,
    type,
    amountCents,
    reference = null,
    meta = {},
  },
  client
) {
  // Get current account balance
  const accountRes = await client.query(
    `SELECT balance_cents
     FROM accounts
     WHERE id = $1
     FOR UPDATE`,
    [accountId]
  );

  if (accountRes.rowCount === 0) {
    throw new Error('Account not found');
  }

  const previousBalance = Number(accountRes.rows[0].balance_cents || 0);
  const newBalance = previousBalance + Number(amountCents);

  if (newBalance < 0) {
    throw new Error('Insufficient funds');
  }

  // Insert transaction
  const txRes = await client.query(
    `INSERT INTO transactions (
      user_id,
      account_id,
      type,
      amount_cents,
      balance_after_cents,
      reference,
      meta
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *`,
    [
      userId,
      accountId,
      type,
      amountCents,
      newBalance,
      reference,
      JSON.stringify(meta),
    ]
  );

  // Update account balance
  await client.query(
    `UPDATE accounts
     SET balance_cents = $1
     WHERE id = $2`,
    [newBalance, accountId]
  );

  return txRes.rows[0];
}

module.exports = {
  postTransaction,
};