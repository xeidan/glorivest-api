// src/workers/sweep.worker.js
'use strict';

const cryptoService = require('../services/crypto.service');
const { sleep } = require('../utils/helpers');

const INTERVAL = Number(process.env.SWEEPER_INTERVAL_MS || 60000); // 60s

async function runOnce() {
  try {
    await cryptoService.sweepAll();
  } catch (err) {
    console.error('sweep worker error:', err.message);
  }
}

async function start() {
  console.log('🚀 TRON Sweeper Started');
  while (true) {
    await runOnce();
    await sleep(INTERVAL);
  }
}

module.exports = { start, runOnce };
