'use strict';

const cycleService = require('../services/cycle.service');

// =====================================================
// START CYCLE
// =====================================================

async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,
  durationMonths
}) {
  return cycleService.startCycle({
    userId,
    walletId,
    capitalAmount,
    expectedProfit,
    durationMonths
  });
}

// =====================================================
// GET CURRENT CYCLE
// =====================================================

async function getCurrentCycle(
  userId,
  accountType
) {
  return cycleService.getCurrentCycle(
    userId,
    accountType
  );
}

// =====================================================
// GET ACTIVE CYCLES
// =====================================================

async function getActiveCycles(
  userId,
  accountType
) {
  return cycleService.getActiveCycles(
    userId,
    accountType
  );
}

// =====================================================
// GET COMPLETED CYCLES
// =====================================================

async function getCompletedCycles(
  userId,
  accountType
) {
  return cycleService.getCompletedCycles(
    userId,
    accountType
  );
}

// =====================================================
// STOP CYCLE
// =====================================================

async function stopCycle({
  userId,
  cycleId
}) {
  return cycleService.stopCycle({
    userId,
    cycleId
  });
}

// =====================================================
// SETTLE COMPLETED CYCLES
// =====================================================

async function settleCompletedCycles() {
  return cycleService.settleCompletedCycles();
}

module.exports = {
  startCycle,
  getCurrentCycle,
  getActiveCycles,
  getCompletedCycles,
  stopCycle,
  settleCompletedCycles
};