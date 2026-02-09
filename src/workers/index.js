'use strict';

// ===============================
// OPTIONAL WORKERS
// ===============================
if (process.env.ENABLE_MARKET_REPLAY === 'true') {
  require('./marketReplayGenerator');
}

if (process.env.ENABLE_WORKER !== 'true') return;

if (process.env.ENABLE_TRON === 'true') {
  require('./tronPoller');
  require('./tronSweeper');
}

if (process.env.ENABLE_WITHDRAWALS === 'true') {
  require('./withdrawalWorker');
}

// ===============================
// CYCLE CRON (FIXED)
// ===============================

if (process.env.ENABLE_CYCLE_CRON === 'true') {
  const { completeExpiredCycles } = require('./completeCycles');

  console.log('🔥 Cycle cron enabled');

  // run once on boot
  completeExpiredCycles().catch(err =>
    console.error('❌ initial completeExpiredCycles failed:', err)
  );

  // then every 10 minutes
  setInterval(() => {
    completeExpiredCycles().catch(err =>
      console.error('❌ completeExpiredCycles error:', err)
    );
  }, 10 * 60 * 1000);
}
