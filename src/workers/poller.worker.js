'use strict';

const depositService = require('../services/deposit.service');
const { sleep } = require('../utils/helpers');

const INTERVAL = Number(process.env.POLLER_INTERVAL_MS || 20000); // 20s
async function runOnce() {
  try {
    const processed = await depositService.pollTron();
    if (processed) console.log(`poller: processed ${processed} deposit(s)`);
  } catch (err) {
    // print err.message to avoid leaking big objects into logs
    console.error('poller error:', (err && err.message) || err);
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
