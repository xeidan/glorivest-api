// src/services/crypto.service.js
'use strict';

const tron = require('../crypto/tron');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/crypto');
const { withTx } = require('../config/database');

// ===================
// WALLET GENERATION
// ===================
exports.createTronWallet = async () => {
  return await tron.createWallet(); // returns { address, privEnc }
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
  const bal = await tron.getUsdtBalance(walletRow.address);
  if (bal <= 0) return false;

  let priv;
  try {
    priv = decrypt(walletRow.priv_enc);
  } catch (err) {
    console.error('decrypt failed for walletId', walletRow.id);
    return false;
  }

  const tx = await tron.sendFromPrivateKey(priv, process.env.OMNIBUS_TRON_ADDRESS, bal);

  await pool.query(
    `UPDATE deposits
     SET swept=true, sweep_tx_hash=$1 
     WHERE to_addr=$2 AND network='tron' AND token='USDT'`,
    [tx, walletRow.address]
  );

  return tx;
};

// ===================
// BULK SWEEP WORKER
// ===================
exports.sweepAll = async () => {
  const { rows } = await pool.query(
    `SELECT id, user_id, address, priv_enc
     FROM wallets
     WHERE network='tron' AND token='USDT' AND sweep_enabled=true`
  );

  for (const row of rows) {
    try {
      await exports.sweepWallet(row);
    } catch (err) {
      console.error('sweep error walletId', row.id, err.message);
    }
  }
};
