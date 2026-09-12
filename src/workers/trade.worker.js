'use strict';

const { pool } = require('../config/database');
const {
  generateTradesForCycle
} = require('../services/performanceEngine.service');

const cycleService = require('../services/cycle.service');

const INTERVAL = Number(
  process.env.TRADE_WORKER_INTERVAL_MS || 5000
);

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

    await cycleService.settleCompletedCycles();

  } catch (err) {
    await client.query('ROLLBACK');
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