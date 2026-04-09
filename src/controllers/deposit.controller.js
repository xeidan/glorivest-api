'use strict';

const { pool } = require('../config/database');
const depositService = require('../services/deposit.service');

/* ================= UTIL ================= */

function generateReference() {
  return `GV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ================= CREATE ================= */

exports.createDeposit = async (req, res) => {
  try {
    const userId = req.user.id;

    let {
      amount_cents,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    } = req.body;

    // 🔒 FORCE NUMBER
    amount_cents = Number(amount_cents);

    console.log('BODY:', req.body);
    console.log('AMOUNT_CENTS:', amount_cents);

    /* ---------- VALIDATION ---------- */

    if (!Number.isFinite(amount_cents) || amount_cents < 5000) {
      return res.status(400).json({ message: 'Minimum deposit is $50' });
    }

    if (!sender_account_name || !sender_account_number || !sender_bank_name) {
      return res.status(400).json({ message: 'Missing bank details' });
    }

    if (!/^\d{10}$/.test(sender_account_number)) {
      return res.status(400).json({ message: 'Account number must be 10 digits' });
    }

    /* ---------- GET RATE ---------- */

    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'USDT_NGN_RATE' LIMIT 1`
    );

    const rate = parseFloat(rows[0]?.value);

    console.log('RATE:', rate);

    if (!Number.isFinite(rate)) {
      return res.status(500).json({ message: 'Invalid rate in settings' });
    }

    /* ---------- CALCULATE ---------- */

    const usd = amount_cents / 100;
    const ngn = usd * rate;

    console.log('USD:', usd);
    console.log('NGN:', ngn);

    if (!Number.isFinite(ngn)) {
      return res.status(500).json({ message: 'NGN calculation failed' });
    }

    const reference = generateReference();

    /* ---------- INSERT ---------- */

    const result = await pool.query(`
      INSERT INTO deposits (
        user_id,
        amount_requested_cents,
        amount_cents,
        amount_exact_cents,
        amount,
        currency,
        src_currency,
        fx_rate,
        fx_at,
        reference,
        status,
        method,
        sender_account_name,
        sender_account_number,
        sender_bank_name
      )
      VALUES (
        $1,  -- user_id
        $2,  -- amount_requested_cents
        $2,  -- amount_cents
        $2,  -- amount_exact_cents
        $3,  -- amount (NGN)
        'USD',
        'NGN',
        $4,  -- fx_rate
        NOW(),
        $5,  -- reference
        'PENDING',
        'BANK',
        $6,
        $7,
        $8
      )
      RETURNING *
    `, [
      userId,
      amount_cents,
      ngn,
      rate,
      reference,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    ]);

    console.log('DEPOSIT CREATED:', result.rows[0]);

    return res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error('CREATE DEPOSIT ERROR:', err);
    return res.status(500).json({ message: 'Deposit failed' });
  }
};

/* ================= MARK PAID ================= */

exports.markPaid = async (req, res) => {
  try {
    await depositService.markDepositPaid(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Marked as paid' });

  } catch (err) {
    console.error('MARK PAID ERROR:', err);
    return res.status(400).json({ message: err.message });
  }
};

/* ================= CANCEL ================= */

exports.cancelDeposit = async (req, res) => {
  try {
    await depositService.cancelDeposit(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Cancelled' });

  } catch (err) {
    console.error('CANCEL ERROR:', err);
    return res.status(400).json({ message: err.message });
  }
};

/* ================= LIST ================= */

exports.listUserDeposits = async (req, res) => {
  try {
    const deposits = await depositService.listUserDeposits(req.user.id);
    return res.json(deposits);

  } catch (err) {
    console.error('LIST ERROR:', err);
    return res.status(400).json({ message: err.message });
  }
};