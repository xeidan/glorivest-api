'use strict';

if (process.env.ENABLE_CYCLE_CRON === 'true') {
  const completeExpiredCycles = require('./completeCycles');

  console.log('🔥 Cycle cron enabled');

  completeExpiredCycles().catch(err => {
    console.error('❌ initial completeExpiredCycles failed:', err);
  });

  setInterval(() => {
    completeExpiredCycles().catch(err => {
      console.error('❌ completeExpiredCycles error:', err);
    });
  }, 10 * 60 * 1000);
}
