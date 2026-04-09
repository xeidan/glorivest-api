'use strict';

const { pool } = require('../config/database');
const depositService = require('../services/deposit.service');

function generateReference() {
  return `GV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ================= CREATE ================= */

exports.createDeposit = async (req, res) => {
  try {
    console.log('CREATE DEPOSIT HIT');

    const userId = req.user.id;

    let {
      amount_cents,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    } = req.body;

    amount_cents = Number(amount_cents);

    if (!amount_cents || amount_cents < 5000) {
      return res.status(400).json({ message: 'Minimum deposit is $50' });
    }

    if (!sender_account_name || !sender_account_number || !sender_bank_name) {
      return res.status(400).json({ message: 'Missing bank details' });
    }

    if (!/^\d{10}$/.test(sender_account_number)) {
      return res.status(400).json({ message: 'Invalid account number' });
    }

    // GET RATE
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'USDT_NGN_RATE' LIMIT 1`
    );

    const rate = Number(rows[0]?.value);

    if (!rate) {
      return res.status(500).json({ message: 'Rate not set' });
    }

    const usd = amount_cents / 100;
    const ngn = usd * rate;

    const reference = generateReference();

    console.log('INSERTING:', {
      userId,
      amount_cents,
      ngn,
      rate,
      reference
    });

    const result = await pool.query(`
      INSERT INTO deposits (
        user_id,
        amount_cents,
        amount_exact_cents,
        amount_requested_cents,
        amount,
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
        $1,
        $2,
        $2,
        $2,
        $3,
        $4,
        NOW(),
        $5,
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

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('DEPOSIT ERROR:', err);
    res.status(500).json({ message: 'Deposit failed' });
  }
};

/* ================= MARK PAID ================= */

exports.markPaid = async (req, res) => {
  try {
    await depositService.markDepositPaid(
      req.user.id,
      req.params.depositId
    );

    res.json({ message: 'Marked as paid' });

  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

/* ================= CANCEL ================= */

exports.cancelDeposit = async (req, res) => {
  try {
    await depositService.cancelDeposit(
      req.user.id,
      req.params.depositId
    );

    res.json({ message: 'Cancelled' });

  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

/* ================= LIST ================= */

exports.listUserDeposits = async (req, res) => {
  try {
    const deposits = await depositService.listUserDeposits(req.user.id);
    res.json(deposits);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};