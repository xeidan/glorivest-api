'use strict';

if (process.env.ENABLE_WORKER !== 'true') {
  console.log('[worker] disabled');
  process.exit(0);
}

const { settleCompletedCycles } =
  require('../controllers/cycle.controller');

const tradeWorker = require('./trade.worker');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {

  console.log('[worker] main worker started');

  // 🔥 Start trade worker in background
  if (process.env.ENABLE_TRADE_WORKER === 'true') {
    tradeWorker.start();
  }

  // Existing cycle settlement loop
  while (true) {
    try {
      const count = await settleCompletedCycles();
      if (count > 0) {
        console.log(`[worker] settled ${count} cycle(s)`);
      }
    } catch (e) {
      console.error('[worker] error', e);
    }

    await sleep(60_000);
  }

})();
