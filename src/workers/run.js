'use strict';

if (process.env.ENABLE_WORKER !== 'true') {
  console.log('[worker] disabled');
  process.exit(0);
}

const { settleCompletedCycles } =
  require('../services/cycle.service');  // ✅ HERE

const tradeWorker = require('./trade.worker');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {

  console.log('[worker] main worker started');

  if (process.env.ENABLE_TRADE_WORKER === 'true') {
    tradeWorker.start();
  }

  while (true) {
    try {

      const settled = await settleCompletedCycles();

      if (settled > 0) {
        console.log(`[worker] settled ${settled} cycle(s)`);
      }

    } catch (err) {
      console.error('[worker] error', err);
    }

    await sleep(60_000);
  }

})();
