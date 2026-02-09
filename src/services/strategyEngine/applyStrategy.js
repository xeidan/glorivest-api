'use strict';

const { simulateStrategy } = require('./simulatedStrategy');
const PRESETS = require('./presets');

/**
 * IMPORTANT:
 * - Does NOT open a DB connection
 * - Does NOT manage transactions
 * - Caller must pass an active pg client
 */
async function runCycleSimulation({ client, cycle, wallet }) {
  if (!client) {
    throw new Error('DB client is required');
  }

  const strategyConfig =
    cycle.strategy_config || PRESETS.BALANCED;

  const result = simulateStrategy({
    capitalCents: wallet.balance_cents,
    config: strategyConfig
  });

  let totalWrittenPnl = 0;

  for (const p of result.positions) {
    // 1. Insert position
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
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,'CLOSED',NOW(),NOW()
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

    const positionId = rows[0].id;

    // 2. Ledger entry
    await client.query(
      `
      INSERT INTO wallet_ledger (
        wallet_id,
        amount_cents,
        reason,
        ref_type,
        ref_id,
        cycle_id
      )
      VALUES ($1,$2,'POSITION_PNL','position',$3,$4)
      `,
      [
        wallet.id,
        p.pnl_cents,
        positionId,
        cycle.id
      ]
    );

    totalWrittenPnl += p.pnl_cents;
  }

  // 3. Sanity check
  if (totalWrittenPnl !== result.total_pnl_cents) {
    throw new Error('PnL mismatch in strategy execution');
  }
}

module.exports = { runCycleSimulation };
