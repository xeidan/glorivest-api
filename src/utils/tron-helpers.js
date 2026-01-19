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



'use strict';

function getTier(capitalCents) {
  const amount = capitalCents / 100;

  if (amount >= 5000) return 'ELITE';
  if (amount >= 500) return 'PRO';
  if (amount >= 50) return 'STANDARD';

  throw new Error('Minimum capital is $50');
}

function getRoiPercent(tier, durationMonths) {
  const table = {
    STANDARD: { 1: 10, 3: 35, 6: 80 },
    PRO:      { 1: 12, 3: 40, 6: 90 },
    ELITE:    { 1: 15, 3: 45, 6: 100 }
  };

  const roi = table[tier]?.[durationMonths];
  if (!roi) throw new Error('Invalid duration');

  return roi;
}

module.exports = {
  getTier,
  getRoiPercent
};
