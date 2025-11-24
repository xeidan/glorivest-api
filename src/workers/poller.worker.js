// src/workers/poller.worker.js
'use strict';

const depositService = require('../services/deposit.service');
const { sleep } = require('../utils/helpers');

const INTERVAL = Number(process.env.POLLER_INTERVAL_MS || 20000); // 20s

async function runOnce() {
  try {
    await depositService.pollTron();
  } catch (err) {
    console.error('poller error:', err.message);
  }
}

async function start() {
  console.log('🚀 TRON Poller Started');
  while (true) {
    await runOnce();
    await sleep(INTERVAL);
  }
}

module.exports = { start, runOnce };
