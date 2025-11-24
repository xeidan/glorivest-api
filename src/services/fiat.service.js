// src/services/fiat.service.js
'use strict';

const { pool } = require('../config/database');
const { withTx } = require('../config/database');

// ENV: FX_NGNUSD = 0.00067 (example: 1 NGN = 0.00067 USD)
const FX = Number(process.env.FX_NGNUSD || 0.00067);

// convert NGN amount to USD
function ngnToUsd(ngn) {
  return Number(ngn) * FX;
}

// ============================
// CREATE PAYMENT RECORD
// ============================
exports.createPayment = async (userId, accountId, amountNgn, provider, ref) => {
  const usd = ngnToUsd(amountNgn);

  const { rows } = await pool.query(
    `INSERT INTO payments (user_id, account_id, amount_cents, currency, provider, provider_ref, status)
     VALUES ($1,$2,$3,'NGN',$4,$5,'initiated')
     RETURNING *`,
    [userId, accountId, Math.round(amountNgn * 100), provider, ref]
  );

  return rows[0];
};

// ============================
// FINALIZE PAYMENT (CALLED BY WEBHOOK)
// ============================
exports.finalizePayment = async (providerRef, providerStatus, payload) => {
  return await withTx(async (c) => {
    const { rows: [p] } = await c.query(
      `SELECT * FROM payments
       WHERE provider_ref=$1
       FOR UPDATE`,
      [providerRef]
    );

    if (!p) return false;
    if (['succeeded','failed','canceled'].includes(p.status)) return true;

    // map Gateway status
    let mapped = 'pending';
    if (providerStatus === 'successful' || providerStatus === 'success') mapped = 'succeeded';
    else if (providerStatus === 'failed') mapped = 'failed';
    else if (providerStatus === 'cancelled') mapped = 'canceled';

    await c.query(
      `UPDATE payments 
       SET status=$1, meta=$2::jsonb 
       WHERE id=$3`,
      [mapped, JSON.stringify(payload || {}), p.id]
    );

    if (mapped !== 'succeeded') return true;

    // Convert NGN -> USD
    const ngn = Number(p.amount_cents) / 100;
    const usdMajor = ngnToUsd(ngn);
    const usdCents = Math.round(usdMajor * 100);

    // Credit user balance
    await c.query(
      `UPDATE users 
       SET balance = balance + $1 
       WHERE id=$2`,
      [usdMajor, p.user_id]
    );

    // Credit account (if exists)
    if (p.account_id) {
      await c.query(
        `UPDATE accounts 
         SET balance_cents = balance_cents + $1 
         WHERE id=$2`,
        [usdCents, p.account_id]
      );
    }

    // Log deposit
    await c.query(
      `INSERT INTO deposits (user_id, account_id, network, token, amount, status, tx_hash)
       VALUES ($1,$2,'fiat','USD',$3,'confirmed',$4)`,
      [p.user_id, p.account_id, usdMajor, providerRef]
    );

    return true;
  });
};
