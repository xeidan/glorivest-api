'use strict';

const { pool } = require('../config/database');
const depositService = require('../services/deposit.service');

function generateReference() {
  return `GV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ================= CREATE ================= */

exports.createDeposit = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      amount_cents,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    } = req.body;

    // ==========================
    // Validation
    // ==========================

    if (!Number.isFinite(amount_cents)) {
      return res.status(400).json({
        message: 'Invalid amount'
      });
    }

    if (amount_cents < 5000) {
      return res.status(400).json({
        message: 'Minimum deposit is $50'
      });
    }

    if (
      !sender_account_name ||
      !sender_account_number ||
      !sender_bank_name
    ) {
      return res.status(400).json({
        message: 'Missing bank details'
      });
    }

    if (!/^\d{10}$/.test(sender_account_number)) {
      return res.status(400).json({
        message: 'Invalid account number'
      });
    }

    // ==========================
    // Get exchange rate
    // ==========================

    const { rows } = await pool.query(
      `
      SELECT value
      FROM settings
      WHERE key = 'USDT_NGN_RATE'
      LIMIT 1
      `
    );

    const rate = Number(rows[0]?.value);

    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(500).json({
        message: 'Invalid exchange rate configuration'
      });
    }

    // ==========================
    // Calculations
    // ==========================

    const usd = amount_cents / 100;
    const ngn = Math.round(usd * rate);

    const reference = generateReference();

    // ==========================
    // Create Deposit
    // ==========================

    const { rows: depositRows } = await pool.query(
      `
      INSERT INTO deposits (
        user_id,
        amount_requested_cents,
        amount_exact_cents,
        amount_cents,
        amount,
        fx_rate,
        reference,
        status,
        method,
        expires_at,
        sender_account_name,
        sender_account_number,
        sender_bank_name
      )
      VALUES (
        $1,
        $2,
        $2,
        $2,
        $3,
        $4,
        $5,
        'AWAITING_PAYMENT',
        'BANK',
        NOW() + INTERVAL '30 minutes',
        $6,
        $7,
        $8
      )
      RETURNING *
      `,
      [
        userId,
        amount_cents,
        ngn,
        rate,
        reference,
        sender_account_name,
        sender_account_number,
        sender_bank_name
      ]
    );

    return res.json(depositRows[0]);

  } catch (err) {

    console.error('CREATE DEPOSIT ERROR:', err);

    return res.status(500).json({
      message: 'Deposit failed'
    });

  }
};

/* ================= MARK PAID ================= */

exports.markPaid = async (req, res) => {
  try {

    await depositService.markDepositPaid(
      req.user.id,
      req.params.depositId
    );

    return res.json({
      message: 'Marked as paid'
    });

  } catch (err) {

    console.error(err);

    return res.status(400).json({
      message: err.message
    });

  }
};

/* ================= CANCEL ================= */

exports.cancelDeposit = async (req, res) => {
  try {

    await depositService.cancelDeposit(
      req.user.id,
      req.params.depositId
    );

    return res.json({
      message: 'Cancelled'
    });

  } catch (err) {

    console.error(err);

    return res.status(400).json({
      message: err.message
    });

  }
};

/* ================= LIST ================= */

exports.listUserDeposits = async (req, res) => {
  try {

    const deposits = await depositService.listUserDeposits(req.user.id);

    return res.json(deposits);

  } catch (err) {

    console.error(err);

    return res.status(400).json({
      message: err.message
    });

  }
};