// src/utils/tron-helpers.js
'use strict';

// Basic TRON address format
exports.isValidTronAddress = (addr) => {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/i.test(addr);
};

// Convert USDT to SUN (1e6)
exports.toSun = (amount) => {
  return BigInt(Math.floor(Number(amount) * 1e6)).toString();
};

// Safe number formatting
exports.toUsd = (num) => Number(Number(num).toFixed(6));
