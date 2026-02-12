'use strict';

const { pool } = require('../config/database');
const { generateTradesForCycle } = require('../services/performanceEngine.service');

const INTERVAL = Number(process.env.TRADE_WORKER_INTERVAL_MS || 60000);

async function runOnce() {

  const client = await pool.connect();

  try {

    const res = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
      `
    );

    for (const cycle of res.rows) {
      await generateTradesForCycle(cycle);
    }

  } catch (err) {
    console.error('trade worker error:', err.message);
  } finally {
    client.release();
  }
}

async function start() {
  console.log('🚀 Trade Worker Started');

  while (true) {
    await runOnce();
    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

module.exports = { start, runOnce };
