'use strict';

const { pool } = require('../config/database');
const { applyWalletDelta } = require('./wallet.service');
const { processReferralReward } = require('./referralReward.service');

async function processSuccessfulDeposit(userId, depositCents) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Credit user's REAL wallet
    await applyWalletDelta(
      client,
      userId,
      'REAL',
      depositCents,
      'DEPOSIT_SUCCESS'
    );

    // Credit referrer (if exists)
    await processReferralReward(
      client,
      userId,
      depositCents
    );

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processSuccessfulDeposit };
