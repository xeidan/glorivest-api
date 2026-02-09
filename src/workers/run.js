'use strict';

if (process.env.ENABLE_WORKER !== 'true') {
  console.log('[worker] cycle worker disabled');
  process.exit(0);
}

const { settleCompletedCycles } =
  require('../controllers/cycle.controller');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log('[worker] cycle worker started');

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
