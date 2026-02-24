'use strict';

const { pool } = require('../config/database');
const {
  createBankDeposit,
  markDepositPaid
} = require('../services/deposit.service');

/**
 * Create a new bank deposit request
 */
async function createDeposit(req, res) {
  try {
    const userId = req.user.id;
    const amountCents = Number(req.body.amount_cents);

    if (!Number.isInteger(amountCents) || amountCents < 5000) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const deposit = await createBankDeposit(userId, amountCents);

    return res.status(201).json(deposit);

  } catch (err) {
    console.error('createDeposit error:', err);
    return res.status(500).json({ message: 'Failed to create deposit' });
  }
}

/**
 * User marks deposit as paid
 */
async function markPaid(req, res) {
  try {
    const userId = req.user.id;
    const depositId = Number(req.params.depositId);

    if (!Number.isInteger(depositId)) {
      return res.status(400).json({ message: 'Invalid deposit ID' });
    }

    await markDepositPaid(userId, depositId);

    return res.json({ ok: true });

  } catch (err) {
    console.error('markPaid error:', err.message);

    if (err.message === 'Deposit not found') {
      return res.status(404).json({ message: err.message });
    }

    if (err.message === 'Invalid deposit state' ||
        err.message === 'Deposit expired') {
      return res.status(400).json({ message: err.message });
    }

    return res.status(500).json({ message: 'Failed to update deposit' });
  }
}

/**
 * List user deposits
 */
async function listUserDeposits(req, res) {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT id,
             amount_requested_cents,
             amount_exact_cents,
             reference,
             method,
             status,
             expires_at,
             created_at
      FROM deposits
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    const now = new Date();

    const deposits = rows.map(d => {
      const isExpired =
        d.status !== 'SUCCESS' &&
        d.expires_at &&
        new Date(d.expires_at) < now;

      return {
        id: d.id,
        amount_requested_cents: Number(d.amount_requested_cents),
        amount_exact_cents: Number(d.amount_exact_cents),
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
    console.error('listUserDeposits error:', err);
    return res.status(500).json({ message: 'Failed to fetch deposits' });
  }
}

module.exports = {
  createDeposit,
  markPaid,
  listUserDeposits
};