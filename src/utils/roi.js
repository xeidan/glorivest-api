'use strict';

/**
 * Determine investment tier by capital
 */
function getTier(capitalCents) {
  if (capitalCents >= 500000) return 'ELITE';
  if (capitalCents >= 100000) return 'PRO';
  return 'STANDARD';
}

/**
 * ROI table (LOCKED AT START)
 */
function getRoiPercent(tier, durationMonths) {
  const table = {
    STANDARD: { 1: 8, 3: 25, 6: 60 },
    PRO:      { 1: 10, 3: 30, 6: 75 },
    ELITE:    { 1: 12, 3: 40, 6: 100 }
  };

  const roi = table[tier]?.[durationMonths];
  if (!roi) throw new Error('Invalid tier or duration');

  return roi;
}

module.exports = {
  getTier,
  getRoiPercent
};
