'use strict';

require('dotenv').config();
require('./index'); // cron + pollers

const { runTradingWorker } = require('./trading.worker');

console.log('[WORKER] started');

setInterval(async () => {
  try {
    await runTradingWorker();
  } catch (e) {
    console.error('[WORKER] loop error:', e);
  }
}, 30_000);

// keep process alive
setInterval(() => {}, 60_000);
