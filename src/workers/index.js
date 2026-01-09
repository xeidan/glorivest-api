'use strict';

if (process.env.ENABLE_TRON === 'true') {
  require('./tronPoller');
  require('./tronSweeper');
}

if (process.env.ENABLE_WITHDRAWALS === 'true') {
  require('./withdrawalWorker');
}

if (process.env.ENABLE_CYCLE_CRON === 'true') {
  require('./completeCycles');
}
if (process.env.ENABLE_CYCLE_CRON === 'true') {
  const { completeExpiredCycles } = require('./completeCycles');
  setInterval(completeExpiredCycles, 10 * 60 * 1000);
}

