'use strict';

require('dotenv').config();
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();

  try {
    // 1. get running cycles
    const { rows: cycles } = await client.query(`
      SELECT id, user_id, wallet_id
      FROM cycles
      WHERE status = 'RUNNING'
    `);

    if (!cycles.length) {
      console.log('No running cycles');
      return;
    }

    // 2. for each symbol, get earliest + latest snapshot (today)
    const { rows: snapshots } = await client.query(`
      SELECT DISTINCT ON (symbol)
        symbol,
        FIRST_VALUE(price) OVER w AS entry_price,
        FIRST_VALUE(recorded_at) OVER w AS opened_at,
        LAST_VALUE(price) OVER w AS exit_price,
        LAST_VALUE(recorded_at) OVER w AS closed_at
      FROM market_prices
      WINDOW w AS (
        PARTITION BY symbol
        ORDER BY recorded_at
        RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      )
    `);

    if (!snapshots.length) {
      console.log('No snapshots');
      return;
    }

    for (const cycle of cycles) {
      for (const snap of snapshots) {
        if (snap.opened_at >= snap.closed_at) continue;

        const side =
          snap.exit_price >= snap.entry_price ? 'LONG' : 'SHORT';

        await client.query(
          `
          INSERT INTO positions (
            user_id,
            wallet_id,
            cycle_id,
            symbol,
            side,
            size,
            entry_price,
            exit_price,
            opened_at,
            closed_at,
            status,
            source
          )
          VALUES (
            $1,$2,$3,$4,$5,
            1,
            $6,$7,
            $8,$9,
            'CLOSED',
            'SNAPSHOT'
          )
          `,
          [
            cycle.user_id,
            cycle.wallet_id,
            cycle.id,
            snap.symbol,
            side,
            snap.entry_price,
            snap.exit_price,
            snap.opened_at,
            snap.closed_at
          ]
        );
      }
    }

    console.log('Positions generated');

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();
