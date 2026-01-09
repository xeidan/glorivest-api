'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  try {
    const res = await pool.query(
      `
      UPDATE investment_cycles
      SET
        accrued_profit = expected_profit,
        status = 'completed',
        updated_at = now()
      WHERE status = 'active'
        AND now() >= end_at
      `
    );

    if (res.rowCount > 0) {
      console.log(`Completed ${res.rowCount} investment cycles`);
    }
  } catch (err) {
    console.error('completeExpiredCycles error', err);
  }
}

module.exports = { completeExpiredCycles };
