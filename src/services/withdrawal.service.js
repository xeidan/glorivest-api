'use strict';

const { pool, withTx } = require('../config/database');
const tron = require('../crypto/tron');
const { postTransaction } = require('./ledger.service');

// =========================
// Create Withdrawal Request
// =========================
exports.createWithdrawalRequest = async (
  userId,
  accountId,
  amountUsd,
  address
) => {
  const amountCents = Math.round(Number(amountUsd) * 100);
  if (!amountCents || amountCents <= 0) {
    throw new Error('Invalid amount');
  }

  return await withTx(async (c) => {
    // 🔒 lock account
    const accQ = await c.query(
      `SELECT balance_cents
       FROM accounts
       WHERE id=$1 AND user_id=$2
       FOR UPDATE`,
      [accountId, userId]
    );

    if (!accQ.rows.length)
      throw new Error('Account not found');

    const balance = Number(accQ.rows[0].balance_cents);

    if (balance < amountCents)
      throw new Error('Insufficient balance');

    // create withdrawal request
    const { rows: [w] } = await c.query(
      `INSERT INTO withdrawals (user_id, account_id, amount_cents, address, status)
       VALUES ($1,$2,$3,$4,'pending')
       RETURNING *`,
      [userId, accountId, amountCents, address]
    );

    // ledger entry (single source of truth)
    await postTransaction({
      userId,
      accountId,
      type: 'withdrawal',
      amountCents: -amountCents
    }, c);

    return w;
  });
};
