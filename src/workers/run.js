'use strict';

require('dotenv').config();
require('./index');

const { runTradingWorker } = require('./trading.worker');

console.log('[WORKER] started');
console.log('[WORKER ENV]', process.env.DATABASE_URL);

// main trading loop
setInterval(async () => {
  try {
    await runTradingWorker();
  } catch (e) {
    console.error('[WORKER] loop error:', e);
  }
}, 30_000);

// 🔒 HARD KEEP-ALIVE (required for Heroku workers)
process.stdin.resume();
