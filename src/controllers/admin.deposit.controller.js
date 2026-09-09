'use strict';

const { pool } = require('../config/database');

// ==========================
// List Deposits
// ==========================
async function listDeposits(req, res) {
  try {
    const { status } = req.query;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        user_id,
        amount_requested_cents,
        amount_exact_cents,
        reference,
        method,
        status,
        expires_at,
        created_at
      FROM deposits
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      `,
      [status || null]
    );

    const now = new Date();

    const deposits = rows.map(d => {
      const isExpired =
        d.status !== 'SUCCESS' &&
        d.expires_at &&
        new Date(d.expires_at) < now;

      return {
        id: d.id,
        user_id: d.user_id,
        amount_requested_cents:
          Number(d.amount_requested_cents),
        amount_exact_cents:
          Number(d.amount_exact_cents),
        reference: d.reference,
        method: d.method,
        status: isExpired ? 'EXPIRED' : d.status,
        expires_at: d.expires_at,
        created_at: d.created_at,
        is_expired: Boolean(isExpired)
      };
    });

    return res.json(deposits);

  } catch (err) {
    console.error('listDeposits error:', err);

    return res.status(500).json({
      message: 'Failed to fetch deposits'
    });
  }
}


// ==========================
// List Withdrawals
// ==========================
async function listWithdrawals(req, res) {
  try {
    const { status } = req.query;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        user_id,
        wallet_id,
        amount_cents,
        currency,
        method,
        destination,
        status,
        provider_ref,
        tx_hash,
        idempotency_key,
        approved_at,
        rejected_at,
        completed_at,
        cancelled_at,
        rejection_reason,
        admin_notes,
        created_at,
        updated_at
      FROM withdrawals
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      `,
      [status || null]
    );

    const withdrawals = rows.map(w => ({
      id: w.id,
      user_id: w.user_id,
      wallet_id: w.wallet_id,
      amount_cents: Number(w.amount_cents),
      currency: w.currency,
      method: w.method,
      destination: w.destination,
      status: w.status,
      provider_ref: w.provider_ref,
      tx_hash: w.tx_hash,
      idempotency_key: w.idempotency_key,
      approved_at: w.approved_at,
      rejected_at: w.rejected_at,
      completed_at: w.completed_at,
      cancelled_at: w.cancelled_at,
      rejection_reason: w.rejection_reason,
      admin_notes: w.admin_notes,
      created_at: w.created_at,
      updated_at: w.updated_at
    }));

    return res.json(withdrawals);

  } catch (err) {
    console.error('listWithdrawals error:', err);

    return res.status(500).json({
      message: 'Failed to fetch withdrawals'
    });
  }
}


module.exports = {
  listDeposits,
  listWithdrawals
};