'use strict';

const ROI_TABLE = {
  STANDARD: { 1: 10, 3: 35, 6: 80 },
  PRO: { 1: 12, 3: 40, 6: 90 },
  ELITE: { 1: 15, 3: 45, 6: 100 }
};

function resolveTier(capitalCents) {
  if (capitalCents < 5_000) return null;
  if (capitalCents < 50_000) return 'STANDARD';
  if (capitalCents < 500_000) return 'PRO';
  return 'ELITE';
}

function resolveROI(tier, months) {
  return ROI_TABLE[tier]?.[months] ?? null;
}

module.exports = { resolveTier, resolveROI };
