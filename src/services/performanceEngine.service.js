'use strict';

const { pool } = require('../config/database');

const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'XAUUSD',
  'EURUSD'
];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function fetchLatestPrice(client, symbol) {
  const { rows } = await client.query(
    `
    SELECT price
    FROM market_prices
    WHERE symbol = $1
    ORDER BY recorded_at DESC
    LIMIT 1
    `,
    [symbol]
  );

  if (!rows.length) {
    return null;
  }

  return Number(rows[0].price);
}

async function generateTradesForCycle(cycle) {
  if (cycle.status !== 'RUNNING') {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    if (new Date() >= new Date(lockedCycle.ends_at)) {
      await client.query('COMMIT');
      return;
    }

    const todayTrades = await client.query(
      `
      SELECT COUNT(*)
      FROM positions
      WHERE cycle_id = $1
        AND DATE(opened_at) = CURRENT_DATE
      `,
      [lockedCycle.id]
    );

    if (Number(todayTrades.rows[0].count) >= 7) {
      await client.query('COMMIT');
      return;
    }

    let balance =
      Number(lockedCycle.capital_cents) / 100;

    const closedTrades = await client.query(
      `
      SELECT
        side,
        qty,
        entry_price,
        exit_price
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      `,
      [lockedCycle.id]
    );

    for (const trade of closedTrades.rows) {
      const pnl =
        trade.side === 'LONG'
          ? (Number(trade.exit_price) - Number(trade.entry_price)) * Number(trade.qty)
          : (Number(trade.entry_price) - Number(trade.exit_price)) * Number(trade.qty);

      balance += pnl;
    }

    if (balance <= 0) {
      await client.query('COMMIT');
      return;
    }

    const symbol =
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    const entryPrice =
      await fetchLatestPrice(client, symbol);

    if (!entryPrice) {
      await client.query('COMMIT');
      return;
    }

    const side =
      Math.random() >= 0.5 ? 'LONG' : 'SHORT';

    const riskAmount = balance * 0.002;

    const qty = riskAmount / entryPrice;

    if (qty <= 0) {
      await client.query('COMMIT');
      return;
    }

    const isWin = Math.random() < 0.70;

    const movePct = randomBetween(
      0.0005,
      0.0015
    );

    const exitPrice =
      side === 'LONG'
        ? (
            isWin
              ? entryPrice * (1 + movePct)
              : entryPrice * (1 - movePct)
          )
        : (
            isWin
              ? entryPrice * (1 - movePct)
              : entryPrice * (1 + movePct)
          );

    const pnl =
      side === 'LONG'
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;

    await client.query(
      `
      INSERT INTO positions
      (
        account_id,
        cycle_id,
        user_id,
        symbol,
        side,
        qty,
        entry_price,
        exit_price,
        pnl,
        status,
        opened_at,
        closed_at,
        source
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
        $9,
        'CLOSED',
        NOW(),
        NOW(),
        'SIMULATION'
      )
      `,
      [
        lockedCycle.account_id,
        lockedCycle.id,
        lockedCycle.user_id,
        symbol,
        side,
        qty,
        entryPrice,
        exitPrice,
        pnl
      ]
    );

    await client.query('COMMIT');
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