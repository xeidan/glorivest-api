'use strict';

const { pool } = require('../config/database');

/*
  Deposit Expiry Worker

  - Expires deposits still AWAITING_PAYMENT
  - Only if expires_at < now()
  - Idempotent
  - Safe for repeated execution
*/

async function expireDeposits() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(`
      UPDATE deposits
      SET status = 'EXPIRED'
      WHERE status = 'AWAITING_PAYMENT'
        AND expires_at < now()
    `);

    await client.query('COMMIT');

    return rowCount;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Run manually
if (require.main === module) {
  expireDeposits()
    .then((count) => {
      console.log(`Expired ${count} deposits`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Deposit expiry failed:', err);
      process.exit(1);
    });
}

module.exports = {
  expireDeposits
};