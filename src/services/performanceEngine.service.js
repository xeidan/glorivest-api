'use strict';

const { pool } = require('../config/database');

/*
|--------------------------------------------------------------------------
| MOCK MARKET
|--------------------------------------------------------------------------
| Simulated reference prices.
| These prices are only used for displaying realistic entry/exit prices.
| They do NOT determine the user's actual cycle entitlement.
|--------------------------------------------------------------------------
*/

const MARKET = {
  BTCUSDT: 112000,
  ETHUSDT: 4300,
  XAUUSD: 3650,
  EURUSD: 1.17
};

const SYMBOLS = Object.keys(MARKET);

/*
|--------------------------------------------------------------------------
| MOCK BOT CONFIGURATION
|--------------------------------------------------------------------------
*/

const MAX_TRADES_PER_DAY = 7;

// Probability that a simulated trade is profitable.
const WIN_RATE = 0.60;

// Winning trades generate a percentage return based on current equity.
const WIN_RETURN_MIN = 0.004; // +0.40%
const WIN_RETURN_MAX = 0.012; // +1.20%

// Losing trades lose a percentage of current equity.
const LOSS_RETURN_MIN = 0.002; // -0.20%
const LOSS_RETURN_MAX = 0.006; // -0.60%

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function getMockPrice(symbol) {
  const basePrice = MARKET[symbol];

  if (!basePrice) {
    return null;
  }

  // Simulate small market movement around reference price.
  const marketMove = randomBetween(-0.001, 0.001);

  return basePrice * (1 + marketMove);
}

function calculatePnl(
  side,
  entryPrice,
  exitPrice,
  qty
) {
  if (side === 'BUY') {
    return (
      (exitPrice - entryPrice) *
      qty
    );
  }

  if (side === 'SELL') {
    return (
      (entryPrice - exitPrice) *
      qty
    );
  }

  return 0;
}

/*
|--------------------------------------------------------------------------
| Generate one simulated trade
|--------------------------------------------------------------------------
*/

async function generateTradesForCycle(cycle) {
  if (!cycle || cycle.status !== 'RUNNING') {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
    |--------------------------------------------------------------------------
    | Lock cycle
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
    | Calculate current simulated equity
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    |
    | The bot's simulated P/L compounds from the cycle's capital.
    |
    | Example:
    |
    | $100 cycle +1% = +$1
    | $500 cycle +1% = +$5
    | $10,000 cycle +1% = +$100
    |
    | This is completely independent of the user's actual entitlement.
    |--------------------------------------------------------------------------
    */

    let balance =
      Number(lockedCycle.capital_cents) / 100;

    const closedTrades = await client.query(
      `
      SELECT
        pnl
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      ORDER BY id ASC
      `,
      [lockedCycle.id]
    );

    for (const trade of closedTrades.rows) {
      if (
        trade.pnl !== null &&
        trade.pnl !== undefined
      ) {
        balance += Number(trade.pnl);
      }
    }

    if (!Number.isFinite(balance) || balance <= 0) {
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

    if (
      !entryPrice ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0
    ) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Select BUY / SELL
    |--------------------------------------------------------------------------
    */

    const side =
      Math.random() >= 0.5
        ? 'BUY'
        : 'SELL';

    /*
    |--------------------------------------------------------------------------
    | Simulate trade result
    |--------------------------------------------------------------------------
    |
    | P/L is based directly on current cycle equity.
    | It is NOT a hard-coded dollar amount.
    |--------------------------------------------------------------------------
    */

    const isWin =
      Math.random() < WIN_RATE;

    const returnPct = isWin
      ? randomBetween(
          WIN_RETURN_MIN,
          WIN_RETURN_MAX
        )
      : -randomBetween(
          LOSS_RETURN_MIN,
          LOSS_RETURN_MAX
        );

    /*
    |--------------------------------------------------------------------------
    | Capital-based P/L
    |--------------------------------------------------------------------------
    */

    const pnl =
      balance * returnPct;

    /*
    |--------------------------------------------------------------------------
    | Simulated position size
    |--------------------------------------------------------------------------
    |
    | Position size is calculated separately because the P/L model
    | is based on account equity rather than quantity.
    |
    | This keeps the displayed position realistic without allowing
    | quantity to distort the intended simulated return.
    |--------------------------------------------------------------------------
    */

    const notionalValue =
      balance *
      randomBetween(0.25, 1.0);

    const qty =
      notionalValue / entryPrice;

    if (
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      await client.query('COMMIT');
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Calculate exit price from the intended P/L
    |--------------------------------------------------------------------------
    |
    | This ensures:
    |
    | displayed entry price
    | +
    | displayed exit price
    | +
    | displayed quantity
    |
    | mathematically produce the same P/L recorded in the database.
    |--------------------------------------------------------------------------
    */

    let exitPrice;

    if (side === 'BUY') {
      exitPrice =
        entryPrice +
        (pnl / qty);
    } else {
      exitPrice =
        entryPrice -
        (pnl / qty);
    }

    if (
      !Number.isFinite(exitPrice) ||
      exitPrice <= 0
    ) {
      await client.query('COMMIT');
      return;
    }

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

    /*
    |--------------------------------------------------------------------------
    | Logging
    |--------------------------------------------------------------------------
    */

    console.log(
      `[MOCK TRADE] Cycle ${lockedCycle.id} | ` +
      `${symbol} ${side} | ` +
      `Capital $${balance.toFixed(2)} | ` +
      `Return ${(returnPct * 100).toFixed(2)}% | ` +
      `P/L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
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