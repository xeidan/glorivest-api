// src/utils/fx.js
'use strict';

const FX_NGNUSD = Number(process.env.FX_NGNUSD || 0);  
// Example: 0.00067 meaning 1 NGN = 0.00067 USD

// Convert NGN major → USD major
exports.ngnToUsd = (amountNgn) => {
  if (!FX_NGNUSD || FX_NGNUSD <= 0) {
    throw new Error('FX_NGNUSD missing or invalid in env');
  }
  return Number(amountNgn) * FX_NGNUSD;
};

// Convert USD major → NGN major
exports.usdToNgn = (amountUsd) => {
  if (!FX_NGNUSD || FX_NGNUSD <= 0) {
    throw new Error('FX_NGNUSD missing or invalid in env');
  }
  return Number(amountUsd) / FX_NGNUSD;
};

// Generic converter
exports.convert = (amount, from, to) => {
  from = from.toUpperCase();
  to   = to.toUpperCase();

  if (from === 'NGN' && to === 'USD') {
    return exports.ngnToUsd(amount);
  }

  if (from === 'USD' && to === 'NGN') {
    return exports.usdToNgn(amount);
  }

  throw new Error(`Unsupported FX pair: ${from} → ${to}`);
};
