'use strict';

const { runTradingWorker } = require('./trading.worker');

console.log('[WORKER] started');

setInterval(async () => {
  try {
    await runTradingWorker();
  } catch (e) {
    console.error('[WORKER] loop error:', e);
  }
}, 30_000); // every 30 seconds
