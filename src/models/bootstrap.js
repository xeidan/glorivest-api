// src/models/bootstrap.js
'use strict';

const { createUserTable } = require('./users');
const { createAccountsTable } = require('./accounts');
const { createWalletsTable } = require('./wallets');
const { createDepositsTable } = require('./deposits');
const { createWithdrawalsTable } = require('./withdrawals');
const { createSettingsTable } = require('./settings');
const { pool } = require('../config/database');

async function seedTiers() {
  await pool.query(`
    INSERT INTO account_tiers (code, display_name, return_percent, min_deposit_cents, fee_cents)
    VALUES
      ('standard','Standard Account',15,2000,0),
      ('pro','Pro Account',20,20000,2000),
      ('elite','Elite Account',25,100000,5000)
    ON CONFLICT (code) DO UPDATE
    SET display_name=EXCLUDED.display_name,
        return_percent=EXCLUDED.return_percent,
        min_deposit_cents=EXCLUDED.min_deposit_cents,
        fee_cents=EXCLUDED.fee_cents;
  `);
}

exports.bootstrapDb = async () => {
  await createUserTable();
  await createAccountsTable();
  await createWalletsTable();
  await createDepositsTable();
  await createWithdrawalsTable();
  await createSettingsTable();
  await seedTiers();

  console.log('✅ Database tables initialized');
};
