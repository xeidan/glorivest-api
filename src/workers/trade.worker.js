'use strict';

const { pool } = require('../config/database');

const {
  generateTradesForCycle
} = require('../services/performanceEngine.service');

const cycleService = require('../services/cycle.service');

const INTERVAL = Number(
  process.env.TRADE_WORKER_INTERVAL_MS || 5000
);

/* ======================================================
   WORKER
====================================================== */

async function runOnce() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE status = 'RUNNING'
      ORDER BY started_at ASC
      FOR UPDATE SKIP LOCKED
      `
    );

    await client.query('COMMIT');

    /*
     * Generate mock positions for running cycles.
     *
     * Market chart data is NOT generated here.
     * Real market data is fetched by price.service.js.
     */
    for (const cycle of cycles) {
      try {
        await generateTradesForCycle(cycle);
      } catch (err) {
        console.error(
          `Trade generation failed for cycle ${cycle.id}:`,
          err.message
        );
      }
    }

    /*
     * Settle completed cycles.
     */
    await cycleService.settleCompletedCycles();

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error('Trade Worker Error:', err);
  } finally {
    client.release();
  }
}

async function start() {
  console.log('🚀 Trade Worker Started');

  while (true) {
    await runOnce();

    await new Promise(resolve =>
      setTimeout(resolve, INTERVAL)
    );
  }
}

module.exports = {
  start,
  runOnce
};