'use strict';

const { pool } = require('../config/database');

/*
|--------------------------------------------------------------------------
| MOCK MARKET
|--------------------------------------------------------------------------
| These are simulated reference prices.
| The engine applies a small random movement to create realistic-looking
| entry and exit prices.
|--------------------------------------------------------------------------
*/

const MARKET = {
  BTCUSDT: 112000,
  ETHUSDT: 4300,
  XAUUSD: 3650,
  EURUSD: 1.17
};

const SYMBOLS = Object.keys(MARKET);

const MAX_TRADES_PER_DAY = 7;
const RISK_PERCENT = 0.002; // 0.2%
const WIN_RATE = 0.70;

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function getMockPrice(symbol) {
  const basePrice = MARKET[symbol];

  if (!basePrice) {
    return null;
  }

  /*
   * Small random market movement around the reference price.
   * This prevents every trade from having the exact same price.
   */
  const marketMove = randomBetween(-0.001, 0.001);

  return basePrice * (1 + marketMove);
}

function calculatePnl(
  side,
  entryPrice,
  exitPrice,
  qty
) {
  if (side === 'LONG') {
    return (
      (exitPrice - entryPrice) *
      qty
    );
  }

  if (side === 'SHORT') {
    return (
      (entryPrice - exitPrice) *
      qty
    );
  }

  return 0;
}

async function generateTradesForCycle(cycle) {
  if (!cycle || cycle.status !== 'RUNNING') {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
    |--------------------------------------------------------------------------
    | Lock the cycle
    |--------------------------------------------------------------------------
    */

    const cycleRes = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE id = $1
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [cycle.id]
    );

    if (!cycleRes.rowCount) {
      await client.query('ROLLBACK');
      return;
    }

    const lockedCycle = cycleRes.rows[0];

    /*
    |--------------------------------------------------------------------------
    | Check cycle expiry
    |--------------------------------------------------------------------------
    */

    if (
      lockedCycle.ends_at &&
      new Date() >= new Date(lockedCycle.ends_at)
    ) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Maximum trades per cycle per day
    |--------------------------------------------------------------------------
    */

    const todayTrades = await client.query(
      `
      SELECT COUNT(*) AS count
      FROM positions
      WHERE cycle_id = $1
        AND DATE(opened_at) = CURRENT_DATE
      `,
      [lockedCycle.id]
    );

    if (
      Number(todayTrades.rows[0].count) >=
      MAX_TRADES_PER_DAY
    ) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Calculate simulated trading balance
    |--------------------------------------------------------------------------
    */

    let balance =
      Number(lockedCycle.capital_cents) / 100;

    const closedTrades = await client.query(
      `
      SELECT
        side,
        qty,
        entry_price,
        exit_price,
        pnl
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      `,
      [lockedCycle.id]
    );

    for (const trade of closedTrades.rows) {
      const pnl =
        trade.pnl !== null &&
        trade.pnl !== undefined
          ? Number(trade.pnl)
          : calculatePnl(
              trade.side,
              Number(trade.entry_price),
              Number(trade.exit_price),
              Number(trade.qty)
            );

      balance += pnl;
    }

    if (balance <= 0) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Select simulated asset
    |--------------------------------------------------------------------------
    */

    const symbol =
      SYMBOLS[
        Math.floor(
          Math.random() * SYMBOLS.length
        )
      ];

    const entryPrice =
      getMockPrice(symbol);

    if (!entryPrice || entryPrice <= 0) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Select direction
    |--------------------------------------------------------------------------
    */

    const side =
      Math.random() >= 0.5
        ? 'LONG'
        : 'SHORT';

    /*
    |--------------------------------------------------------------------------
    | Position sizing
    |--------------------------------------------------------------------------
    */

    const riskAmount =
      balance * RISK_PERCENT;

    const qty =
      riskAmount / entryPrice;

    if (!Number.isFinite(qty) || qty <= 0) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Simulate trade result
    |--------------------------------------------------------------------------
    */

    const isWin =
      Math.random() < WIN_RATE;

    const movePct =
      randomBetween(0.0005, 0.0015);

    let exitPrice;

    if (side === 'LONG') {
      exitPrice = isWin
        ? entryPrice * (1 + movePct)
        : entryPrice * (1 - movePct);
    } else {
      exitPrice = isWin
        ? entryPrice * (1 - movePct)
        : entryPrice * (1 + movePct);
    }

    const pnl = calculatePnl(
      side,
      entryPrice,
      exitPrice,
      qty
    );

    /*
    |--------------------------------------------------------------------------
    | Insert simulated position
    |--------------------------------------------------------------------------
    */

    await client.query(
      `
      INSERT INTO positions
      (
        user_id,
        symbol,
        side,
        qty,
        entry_price,
        exit_price,
        pnl,
        fees,
        status,
        opened_at,
        closed_at,
        duration_sec,
        strategy,
        notes,
        cycle_id,
        account_id
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        'CLOSED',
        NOW(),
        NOW(),
        $9,
        $10,
        $11,
        $12,
        $13
      )
      `,
      [
        lockedCycle.user_id,
        symbol,
        side,
        qty,
        entryPrice,
        exitPrice,
        pnl,
        0,
        60,
        'MOCK_BOT',
        isWin
          ? 'Simulated winning position'
          : 'Simulated losing position',
        lockedCycle.id,
        lockedCycle.account_id
      ]
    );

    await client.query('COMMIT');

    console.log(
      `[MOCK TRADE] Cycle ${lockedCycle.id} | ` +
      `${symbol} ${side} | ` +
      `Entry ${entryPrice.toFixed(2)} | ` +
      `Exit ${exitPrice.toFixed(2)} | ` +
      `P/L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
    );

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  generateTradesForCycle
};