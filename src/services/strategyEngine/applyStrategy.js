'use strict';

const { pool } = require('../../config/database');
const { simulateStrategy } = require('./simulatedStrategy');

async function runCycleSimulation({ cycle, wallet }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = simulateStrategy({
      capitalCents: wallet.balance_cents,
      config: cycle.strategy_config
    });

    for (const p of result.positions) {
      const { rows } = await client.query(
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
          pnl_cents,
          status,
          opened_at,
          closed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,'CLOSED',now(),now()
        )
        RETURNING id
        `,
        [
          wallet.user_id,
          wallet.id,
          cycle.id,
          p.symbol,
          p.side,
          p.size,
          p.entry_price,
          p.exit_price,
          p.pnl_cents
        ]
      );

      await client.query(
        `
        INSERT INTO wallet_ledger (
          wallet_id,
          amount_cents,
          reason,
          ref_type,
          ref_id,
          cycle_id
        ) VALUES ($1,$2,'POSITION_PNL','position',$3,$4)
        `,
        [wallet.id, p.pnl_cents, rows[0].id, cycle.id]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { runCycleSimulation };
