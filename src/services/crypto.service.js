// src/services/crypto.service.js
'use strict';

const tron = require('../crypto/tron');
const { pool } = require('../config/database');

// ===================
// WALLET GENERATION
// ===================
exports.createTronWallet = async () => {
  return await tron.createWallet(); // returns { address, privEnc } (unchanged)
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
  // wallets table (per your schema) has columns: id, account_id, network, address, private_key, created_at, updated_at, user_id
  const { rows } = await pool.query(
    `SELECT id, user_id, address, private_key
     FROM wallets
     WHERE network = 'tron' AND (private_key IS NOT NULL AND private_key <> '')
     ORDER BY id ASC
     LIMIT 200`
  );

  for (const row of rows) {
    try {
      await exports.sweepWallet(row);
    } catch (err) {
      console.error('sweep error walletId', row.id, (err && err.message) || err);
    }
  }
};
