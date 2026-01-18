'use strict';

const ROI_TABLE = {
  Standard: { 1: 10, 3: 35, 6: 80 },
  Pro:      { 1: 12, 3: 40, 6: 90 },
  Elite:    { 1: 15, 3: 45, 6: 100 }
};

function resolveTier(amountCents) {
  if (amountCents >= 5_000_00) return 'Elite';
  if (amountCents >= 500_00) return 'Pro';
  if (amountCents >= 50_00) return 'Standard';
  return null;
}

function resolveROI(amountCents, durationMonths) {
  const tier = resolveTier(amountCents);
  if (!tier) return null;

  const roi = ROI_TABLE[tier][durationMonths];
  if (roi == null) return null;

  return { tier, roi };
}

module.exports = { resolveROI };
