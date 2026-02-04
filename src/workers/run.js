'use strict';

require('dotenv').config();
require('./index'); // cron + pollers

const { runTradingWorker } = require('./trading.worker');


const cron = require('node-cron');
const { settleCompletedCycles } = require('../controllers/cycle.controller');

console.log('🔥 Cycle cron enabled');
console.log('[WORKER] started');

cron.schedule('*/1 * * * *', async () => {
  try {
    const count = await settleCompletedCycles();
    if (count > 0) {
      console.log(`[CYCLE] Settled ${count} completed cycles`);
    }
  } catch (e) {
    console.error('Cycle settlement failed:', e);
  }
});


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
