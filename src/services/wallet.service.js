// src/services/wallet.service.js
'use strict';

const { pool } = require('../config/database');
const tron = require('../crypto/tron');
const { decrypt } = require('../utils/crypto');

exports.generateUserWallet = async (userId) => {
  const { address, privEnc } = await tron.createWallet();

  await pool.query(
    `UPDATE users 
     SET tron_wallet=$1, tron_private_encrypted=$2
     WHERE id=$3`,
    [address, privEnc, userId]
  );

  return { address };
};

// Get live balance from TRON node
exports.getTronBalance = tron.getUsdtBalance;

// Sweep a specific wallet
exports.sweepWallet = async (wallet) => {
  const bal = await tron.getUsdtBalance(wallet.address);
  if (bal <= 0) return false;

  let priv;
  try { priv = decrypt(wallet.priv_enc); }
  catch { return false; }

  await tron.sendFromPrivateKey(priv, wallet.destination, bal);
  return true;
};
