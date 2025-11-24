// src/workers/withdrawal.worker.js
'use strict';

const withdrawalService = require('../services/withdrawal.service');
const { sleep } = require('../utils/helpers');

const INTERVAL = Number(process.env.WITHDRAWAL_WORKER_INTERVAL_MS || 30000); // 30s

async function runOnce() {
  try {
    await withdrawalService.processWithdrawalsOnce();
    await withdrawalService.confirmWithdrawalsOnce();
  } catch (err) {
    console.error('withdrawal worker error:', err.message);
  }
}

async function start() {
  console.log('🚀 Withdrawal Worker Started');
  while (true) {
    await runOnce();
    await sleep(INTERVAL);
  }
}

module.exports = { start, runOnce };
