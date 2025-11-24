// src/crypto/tron.js
'use strict';

const TronWeb = require('tronweb');
const fetch = require('node-fetch');
const { encrypt, decrypt } = require('../utils/crypto');
const {
  TRON_FULLHOST,
  TRONGRID_API_KEY,
  USDT_TRON_CONTRACT,
  OMNIBUS_TRON_PRIVATE_KEY,
  OMNIBUS_TRON_ADDRESS,
} = require('../config/env');

const tronWeb = new TronWeb({
  fullHost: TRON_FULLHOST,
  headers: TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_API_KEY } : {},
});

// ========== Create Wallet ==========
exports.createWallet = async () => {
  const acct = await tronWeb.createAccount();
  const address = acct.address.base58;
  const priv = acct.privateKey;
  const privEnc = encrypt(priv);

  return { address, privEnc, priv };
};

// ========== Load USDT Contract ==========
async function getUsdtContract() {
  return tronWeb.contract().at(USDT_TRON_CONTRACT);
}
exports.getUsdtContract = getUsdtContract;

// ========== Check USDT Balance ==========
exports.getUsdtBalance = async (address) => {
  try {
    const c = await getUsdtContract();
    const hex = tronWeb.address.toHex(address);

    const raw = await c.balanceOf(hex).call();
    const val = BigInt(raw || 0);
    return Number(val) / 1e6;
  } catch (e) {
    return 0;
  }
};

// ========== Transfer USDT (from OMNIBUS) ==========
exports.sendFromOmnibus = async (to, amountUSDT) => {
  const c = await getUsdtContract();
  const sun = BigInt(Math.floor(amountUSDT * 1e6)).toString();

  tronWeb.setAddress(OMNIBUS_TRON_ADDRESS);

  return await c.transfer(to, sun).send({
    privateKey: OMNIBUS_TRON_PRIVATE_KEY,
  });
};

// ========== Transfer from User Deposit Wallet (for Sweeper) ==========
exports.sendFromPrivateKey = async (fromPriv, to, amountUSDT) => {
  const c = await getUsdtContract();
  const sun = BigInt(Math.floor(amountUSDT * 1e6)).toString();

  const addr = tronWeb.address.fromPrivateKey(fromPriv);
  tronWeb.setAddress(addr);

  return await c.transfer(to, sun).send({ privateKey: fromPriv });
};

// ========== Get TRX Receipt ==========
exports.getReceipt = async (tx) => {
  try {
    const info = await tronWeb.trx.getTransactionInfo(tx);
    if (!info || Object.keys(info).length === 0) return { found: false };

    const ok = info?.receipt?.result?.toUpperCase() === 'SUCCESS';
    return { found: true, ok };
  } catch {
    return { found: false };
  }
};

// expose tronWeb
exports.tronWeb = tronWeb;
