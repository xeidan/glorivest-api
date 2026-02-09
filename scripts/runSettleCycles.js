'use strict';

const { settleCompletedCycles } =
  require('../controllers/cycle.controller');

(async () => {
  try {
    const count = await settleCompletedCycles();
    console.log(`Settled ${count} cycle(s)`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
