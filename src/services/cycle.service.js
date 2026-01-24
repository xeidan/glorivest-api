// src/services/cycle.service.js
'use strict';

/**
 * ⚠️ DEPRECATED — DO NOT USE
 *
 * This service belongs to the **legacy investment engine**
 * that relied on:
 *   - investment_cycles
 *   - ledger_entries
 *
 * The current trading system uses:
 *   - trading_cycles
 *   - direct wallet mutations
 *
 * ❌ This file MUST NOT be imported or called.
 * ❌ Any usage indicates a bug.
 *
 * See:
 *   - controllers/trade.controller.js
 *   - workers/completeExpiredCycles.js
 *   - workers/trading.worker.js
 */

function deprecated() {
  throw new Error(
    'cycle.service.js is deprecated and must not be used. ' +
    'Use trade.controller + trading_cycles instead.'
  );
}

async function startCycle() {
  deprecated();
}

async function forfeitCycle() {
  deprecated();
}

module.exports = {
  startCycle,
  forfeitCycle
};
