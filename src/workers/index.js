'use strict';

/**
 * Workers bootstrap
 * 
 * RULES:
 * - NO market replay
 * - NO fake price generation
 * - ONLY deterministic cron jobs
 * - EVERYTHING behind explicit env flags
 */

/* ===============================
   CYCLE CRON (REQUIRED)
   =============================== */

if (process.env.ENABLE_CYCLE_CRON === 'true') {
  const { completeExpiredCycles } = require('./completeCycles');

  console.log('🔥 Cycle cron enabled');

  // run once on boot
  completeExpiredCycles().catch(err => {
    console.error('❌ initial completeExpiredCycles failed:', err);
  });

  // then every 10 minutes
  setInterval(() => {
    completeExpiredCycles().catch(err => {
      console.error('❌ completeExpiredCycles error:', err);
    });
  }, 10 * 60 * 1000);
}

/* ===============================
   BLOCK EVERYTHING ELSE
   =============================== */

// Explicitly DO NOT load any other workers.
// Market replay, price engines, simulations are disabled by design.
