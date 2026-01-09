'use strict';

const {
  startCycle: startCycleService,
  stopCycle: stopCycleService,
  getCurrentCycle: getCurrentCycleService
} = require('../services/investmentCycle.service');

// ------------------------------------
// START CYCLE
// ------------------------------------
async function startCycle({ userId, walletId, expectedProfit }) {
  return startCycleService({ userId, walletId, expectedProfit });
}

// ------------------------------------
// STOP CYCLE (FORFEIT)
// ------------------------------------
async function stopCycle({ userId, walletId }) {
  return stopCycleService({ userId, walletId });
}

// ------------------------------------
// CURRENT CYCLE (READ ONLY)
// ------------------------------------
async function getCurrentCycle({ userId, walletId }) {
  return getCurrentCycleService({ userId, walletId });
}

module.exports = {
  startCycle,
  stopCycle,
  getCurrentCycle
};
