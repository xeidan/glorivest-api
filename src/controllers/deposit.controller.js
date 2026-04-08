'use strict';

const depositService = require('../services/deposit.service');

// ==========================
// Create Deposit
// ==========================
exports.createDeposit = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      amount_cents,
      method,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    } = req.body;

    if (!amount_cents || amount_cents < 5000) {
      return res.status(400).json({ message: 'Minimum deposit is $50' });
    }

    // 🔑 GET RATE FROM SETTINGS
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'USDT_NGN_RATE' LIMIT 1`
    );

    const rate = Number(rows[0]?.value || 0);

    if (!rate) {
      return res.status(500).json({ message: 'Rate not set' });
    }

    const usd = amount_cents / 100;
    const ngn = usd * rate;

    // 🔒 CREATE DEPOSIT (LOCK RATE)
    const result = await pool.query(`
      INSERT INTO deposits (
        user_id,
        amount_cents,
        amount,
        currency,
        src_currency,
        fx_rate,
        fx_at,
        status,
        sender_account_name,
        sender_account_number,
        sender_bank_name
      )
      VALUES (
        $1, $2, $3,
        'USD',
        'NGN',
        $4,
        NOW(),
        'PENDING',
        $5, $6, $7
      )
      RETURNING *
    `, [
      userId,
      amount_cents,
      ngn,
      rate,
      sender_account_name,
      sender_account_number,
      sender_bank_name
    ]);

    return res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Deposit failed' });
  }
};

// ==========================
// Mark Deposit Paid
// ==========================
exports.markPaid = async (req, res) => {
  try {
    await depositService.markDepositPaid(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Marked as paid' });

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

// ==========================
// Cancel Deposit
// ==========================
exports.cancelDeposit = async (req, res) => {
  try {
    await depositService.cancelDeposit(
      req.user.id,
      req.params.depositId
    );

    return res.json({ message: 'Deposit cancelled' });

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

// ==========================
// List User Deposits
// ==========================
exports.listUserDeposits = async (req, res) => {
  try {
    const deposits = await depositService.listUserDeposits(
      req.user.id
    );

    return res.json(deposits);

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};