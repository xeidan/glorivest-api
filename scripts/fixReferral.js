'use strict';

require('dotenv').config();

const { pool } = require('../src/config/database');
const { applyWalletDelta } = require('../src/services/wallet.service');

async function run() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // user_id = 2
    // wallet_type = 'REFERRAL'
    // amount = +2000 cents
    await applyWalletDelta(
      client,
      2,
      'REFERRAL',
      2000,
      'REF_CORRECTION'
    );

    await client.query('COMMIT');

    console.log('Referral wallet corrected successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Correction failed:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}

run();