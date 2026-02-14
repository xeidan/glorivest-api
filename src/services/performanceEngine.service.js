'use strict';

const { pool } = require('../config/database');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'XAUUSD', 'EURUSD'];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function fetchLatestPrice(client, symbol) {
  const res = await client.query(
    `
    SELECT price
    FROM market_prices
    WHERE symbol = $1
    ORDER BY recorded_at DESC
    LIMIT 1
    `,
    [symbol]
  );

  if (!res.rowCount) return null;
  return Number(res.rows[0].price);
}

async function generateTradesForCycle(cycle) {

  if (cycle.status !== 'RUNNING') return;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 🔒 Lock cycle row
    const cycleLock = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE id = $1
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [cycle.id]
    );

    if (!cycleLock.rowCount) {
      await client.query('ROLLBACK');
      return;
    }

    const lockedCycle = cycleLock.rows[0];
    const now = new Date();
    const cycleEnd = new Date(lockedCycle.ends_at);

    // Stop if expired
    if (now >= cycleEnd) {
      await client.query('COMMIT');
      return;
    }

    // ✅ HARD CAP: Max 7 trades per calendar day
    const todayRes = await client.query(
      `
      SELECT COUNT(*)
      FROM positions
      WHERE cycle_id = $1
        AND DATE(opened_at) = CURRENT_DATE
      `,
      [lockedCycle.id]
    );

    const tradesToday = Number(todayRes.rows[0].count);

    if (tradesToday >= 7) {
      await client.query('COMMIT');
      return;
    }

    // 🔁 Recalculate balance from CLOSED trades
    const principal = Number(lockedCycle.capital_cents) / 100;
    let balance = principal;

    const existingTrades = await client.query(
      `
      SELECT side, size, entry_price, exit_price
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      `,
      [lockedCycle.id]
    );

    for (const t of existingTrades.rows) {
      const pnl =
        t.side === 'LONG'
          ? (t.exit_price - t.entry_price) * t.size
          : (t.entry_price - t.exit_price) * t.size;

      balance += Number(pnl);
    }

    if (balance <= 0) {
      await client.query('COMMIT');
      return;
    }

    // 🎯 Create ONE trade per worker tick
    const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const entry = await fetchLatestPrice(client, symbol);

    if (!entry) {
      await client.query('COMMIT');
      return;
    }

    const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

    // 🔽 Reduced risk (0.2%)
    const riskAmount = balance * 0.002;
    const size = riskAmount / entry;

    if (size <= 0) {
      await client.query('COMMIT');
      return;
    }

    const isWin = Math.random() < 0.7;

    // 🔽 Small move size
    const movePct = randomBetween(0.0005, 0.0015);

    const exit =
      side === 'LONG'
        ? (isWin ? entry * (1 + movePct) : entry * (1 - movePct))
        : (isWin ? entry * (1 - movePct) : entry * (1 + movePct));

    await client.query(
      `
      INSERT INTO positions
      (
        cycle_id,
        symbol,
        side,
        size,
        entry_price,
        exit_price,
        status,
        opened_at,
        closed_at,
        user_id,
        wallet_id,
        source
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,'CLOSED',NOW(),NOW(),$7,$8,'SIMULATION')
      `,
      [
        lockedCycle.id,
        symbol,
        side,
        size,
        entry,
        exit,
        lockedCycle.user_id,
        lockedCycle.wallet_id
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

module.exports = { generateTradesForCycle };
