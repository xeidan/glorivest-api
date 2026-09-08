'use strict';

const { pool } = require('../config/database');
const depositService = require('../services/deposit.service');

function generateReference() {
  return `GV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ================= CREATE DEPOSIT ================= */

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

    // ==========================
    // Validate amount
    // ==========================

    const amountCents = Number(amount_cents);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        message: 'Invalid amount'
      });
    }

    // Keep current minimum for now.
    // We can change this separately later.
    if (amountCents < 5000) {
      return res.status(400).json({
        message: 'Minimum deposit is $50'
      });
    }

    const depositMethod = String(method || 'BANK').toUpperCase();

    // ==========================
    // CRYPTO DEPOSIT
    // ==========================

    if (depositMethod === 'CRYPTO') {
      try {
        const wallet =
          await depositService.getOrCreateCryptoWallet(userId);

        if (!wallet || !wallet.address) {
          return res.status(500).json({
            message: 'Crypto wallet unavailable'
          });
        }

        return res.json({
          id: null,
          method: 'CRYPTO',

          address: wallet.address,

          network: 'TRON',

          token: 'USDT',

          amount_cents: amountCents,

          amount: amountCents / 100
        });

      } catch (err) {
        console.error(
          'CRYPTO DEPOSIT ERROR:',
          err
        );

        return res.status(400).json({
          message: err.message || 'Unable to load crypto wallet'
        });
      }
    }

    // ==========================
    // BANK DEPOSIT
    // ==========================

    if (depositMethod !== 'BANK') {
      return res.status(400).json({
        message: 'Unsupported deposit method'
      });
    }

    // ==========================
    // Bank details validation
    // ==========================

    if (
      !sender_account_name ||
      !sender_account_number ||
      !sender_bank_name
    ) {
      return res.status(400).json({
        message: 'Missing bank details'
      });
    }

    if (!/^\d{10}$/.test(String(sender_account_number))) {
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
    // Calculate NGN amount
    // ==========================

    const usd = amountCents / 100;
    const ngn = Math.round(usd * rate);

    const reference = generateReference();

    // ==========================
    // Create bank deposit
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
        amountCents,
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
    console.error(
      'CREATE DEPOSIT ERROR:',
      err
    );

    return res.status(500).json({
      message: err.message || 'Deposit failed'
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
    console.error(
      'MARK DEPOSIT PAID ERROR:',
      err
    );

    return res.status(400).json({
      message: err.message || 'Unable to mark deposit as paid'
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
    console.error(
      'CANCEL DEPOSIT ERROR:',
      err
    );

    return res.status(400).json({
      message: err.message || 'Unable to cancel deposit'
    });
  }
};

/* ================= LIST ================= */

exports.listUserDeposits = async (req, res) => {
  try {
    const deposits =
      await depositService.listUserDeposits(
        req.user.id
      );

    return res.json(deposits);

  } catch (err) {
    console.error(
      'LIST DEPOSITS ERROR:',
      err
    );

    return res.status(400).json({
      message: err.message || 'Unable to load deposits'
    });
  }
};