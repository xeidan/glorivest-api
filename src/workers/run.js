'use strict';
require('dotenv').config();

console.log('[WORKER ENV]', process.env.DATABASE_URL);


const { runTradingWorker } = require('./trading.worker');

console.log('[WORKER] started');

setInterval(async () => {
  try {
    await runTradingWorker();
  } catch (e) {
    console.error('[WORKER] loop error:', e);
  }
}, 30_000); // every 30 seconds
