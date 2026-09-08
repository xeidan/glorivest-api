// src/services/crypto.service.js
'use strict';

const tron = require('../crypto/tron');
const { pool } = require('../config/database');

// ===================
// WALLET GENERATION
// ===================
exports.createTronWallet = async (userId, accountId) => {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!accountId) {
    throw new Error('accountId is required');
  }

  // Check whether this account already has a TRON/USDT wallet.
  const { rows: existing } = await pool.query(
    `
    SELECT
      id,
      user_id,
      account_id,
      network,
      token,
      address,
      sweep_enabled,
      created_at
    FROM wallets
      WHERE user_id = $1
        AND network = 'tron'
        AND token = 'USDT'
    LIMIT 1
    `,
    [userId, accountId]
  );

  if (existing.length) {
    return existing[0];
  }

  // Generate a new blockchain wallet.
  const wallet = await tron.createWallet();

  // Persist it against the user's LIVE financial account.
  const { rows } = await pool.query(
    `
    INSERT INTO wallets
    (
      user_id,
      account_id,
      network,
      token,
      address,
      priv_enc,
      sweep_enabled
    )
    VALUES
    ($1, $2, 'tron', 'USDT', $3, $4, true)
    RETURNING
      id,
      user_id,
      account_id,
      network,
      token,
      address,
      sweep_enabled,
      created_at
    `,
    [
      userId,
      accountId,
      wallet.address,
      wallet.privEnc
    ]
  );

  return rows[0];
};

// ==================
// CREATE BALANCE
// ==================
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

    const depositMethod =
      String(method || 'BANK').toUpperCase();

    // ==========================
    // CRYPTO DEPOSIT
    // ==========================

    if (depositMethod === 'CRYPTO') {

      const cryptoService = require('../services/crypto.service');

      // Get user's LIVE financial account
      const { rows: accounts } = await pool.query(
        `
        SELECT id
        FROM accounts
        WHERE user_id = $1
          AND account_type = 'LIVE'
          AND status = 'ACTIVE'
        LIMIT 1
        `,
        [userId]
      );

      if (!accounts.length) {
        return res.status(400).json({
          message: 'Live account not found'
        });
      }

      const accountId = accounts[0].id;

      // Get or create the user's unique TRON USDT wallet
      const wallet =
        await cryptoService.createTronWallet(
          userId,
          accountId
        );

      return res.json({
        method: 'CRYPTO',
        network: 'tron',
        token: 'USDT',
        address: wallet.address,
        account_id: accountId,
        wallet_id: wallet.id,
        amount_cents
      });
    }

    // ==========================
    // BANK VALIDATION
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
    // Create BANK Deposit
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

// ===================
// GET BALANCE
// ===================
exports.getTronBalance = async (address) => {
  return await tron.getUsdtBalance(address);
};

// ===================
// SEND USDT FROM OMNIBUS
// ===================
exports.sendFromOmnibus = async (to, amountUsd) => {
  return await tron.sendFromOmnibus(to, amountUsd);
};

// ===================
// SEND USDT FROM PRIVATE KEY
// ===================
exports.sendFromPrivateKey = async (privHex, to, amountUsd) => {
  return await tron.sendFromPrivateKey(privHex, to, amountUsd);
};

// ===================
// CONFIRM TRANSACTION
// ===================
exports.getReceipt = async (txHash) => {
  return await tron.getReceipt(txHash);
};

// ===================
// SWEEP USER ADDRESS
// ===================
exports.sweepWallet = async (walletRow) => {
  if (!walletRow || !walletRow.address) {
    throw new Error('sweepWallet: invalid walletRow');
  }

  const bal = await tron.getUsdtBalance(walletRow.address);
  if (!bal || Number(bal) <= 0) return false;

  // prefer explicit private_key column (from your schema). if not present, try private_key or privateKey
  const privKey = walletRow.private_key || walletRow.priv_enc || walletRow.privateKey;
  if (!privKey) {
    console.error('sweepWallet: no private key for walletId', walletRow.id);
    return false;
  }

  // send everything to omnibus address
  const omnibus = process.env.OMNIBUS_TRON_ADDRESS;
  if (!omnibus) {
    console.error('sweepWallet: OMNIBUS_TRON_ADDRESS not configured');
    return false;
  }

  let tx;
  try {
    tx = await tron.sendFromPrivateKey(privKey, omnibus, bal);
  } catch (err) {
    console.error('sweepWallet: failed to send for walletId', walletRow.id, err.message || err);
    return false;
  }

  try {
    await pool.query(
      `UPDATE deposits
       SET swept = true, sweep_tx_hash = $1, updated_at = NOW()
       WHERE to_addr = $2 AND network = 'tron' AND token = 'USDT'`,
      [tx, walletRow.address]
    );
  } catch (err) {
    console.error('sweepWallet: failed to update deposits for walletId', walletRow.id, err.message || err);
    // still return tx so caller can decide
  }

  return tx;
};

// ===================
// BULK SWEEP WORKER
// ===================
exports.sweepAll = async () => {
  const { rows } = await pool.query(
    `
    SELECT
      w.id,
      w.user_id,
      w.account_id,
      w.address,
      w.private_key
    FROM wallets w
    WHERE w.network = 'tron'
      AND w.private_key IS NOT NULL
      AND w.private_key <> ''
      AND EXISTS (
        SELECT 1
        FROM deposits d
        WHERE d.to_addr = w.address
          AND d.network = 'tron'
          AND d.token = 'USDT'
          AND COALESCE(d.swept, false) = false
      )
    ORDER BY w.id ASC
    LIMIT 200
    `
  );

  for (const row of rows) {
    try {
      await exports.sweepWallet(row);
    } catch (err) {
      console.error(
        'sweep error walletId',
        row.id,
        err?.message || err
      );
    }
  }
};
