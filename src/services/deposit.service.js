'use strict';

const { withTx } = require('../config/database');
const { postTransaction } = require('./ledger.service');
const crypto = require('crypto');

// =========================
// Create deposit reference
// =========================
exports.generateDepositReference = async (userId, accountId, amountUsd) => {
  const amountCents = Math.round(Number(amountUsd) * 100);
  if (!amountCents || amountCents <= 0) {
    throw new Error('Invalid amount');
  }

  const reference = `DEP_${crypto.randomUUID()}`;

  return withTx(async (c) => {
    // ensure account exists + belongs to user
    const q = await c.query(
      `SELECT id FROM accounts WHERE id=$1 AND user_id=$2`,
      [accountId, userId]
    );
    if (!q.rows.length) throw new Error('Account not found');

    const { rows: [dep] } = await c.query(
      `INSERT INTO deposits (user_id, account_id, amount_cents, reference, status)
       VALUES ($1,$2,$3,$4,'pending')
       RETURNING *`,
      [userId, accountId, amountCents, reference]
    );

    return dep;
  });
};
