'use strict';

const cycleService = require('../services/cycle.service');

// =====================================================
// START CYCLE
// =====================================================

async function startCycle({
  userId,
  capitalAmount,
  expectedProfit,
  durationMonths
}) {
  return cycleService.startCycle({
    userId,
    capitalAmount,
    expectedProfit,
    durationMonths
  });
}

// =====================================================
// GET CURRENT CYCLE
// =====================================================

async function getCurrentCycle(userId) {
  return cycleService.getCurrentCycle(userId);
}

// =====================================================
// GET ACTIVE CYCLES
// =====================================================

async function getActiveCycles(userId) {
  return cycleService.getActiveCycles(userId);
}

// =====================================================
// GET COMPLETED CYCLES
// =====================================================

async function getCompletedCycles(userId) {
  return cycleService.getCompletedCycles(userId);
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