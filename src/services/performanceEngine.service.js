'use strict';

const { pool } = require('../config/database');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'XAUUSD', 'EURUSD'];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function tradesPerDay(duration) {
  if (duration === 30) return 7;
  if (duration === 90) return 4;
  if (duration === 180) return 3;
  return 3;
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

    const principal = Number(lockedCycle.capital_cents) / 100;
    const cycleStart = new Date(lockedCycle.started_at);
    const cycleEnd = new Date(lockedCycle.ends_at);
    const now = new Date();

    // Stop if expired
    if (now >= cycleEnd) {
      await client.query('COMMIT');
      return;
    }

    // ✅ Authoritative duration from timestamps
    const durationDays = Math.max(
      1,
      Math.ceil((cycleEnd - cycleStart) / 86400000)
    );

    if (![30, 90, 180].includes(durationDays)) {
      await client.query('COMMIT');
      return;
    }

    const totalTrades = tradesPerDay(durationDays) * durationDays;
    if (totalTrades <= 0) {
      await client.query('COMMIT');
      return;
    }

    // Existing trade count
    const countRes = await client.query(
      `SELECT COUNT(*) FROM positions WHERE cycle_id = $1`,
      [lockedCycle.id]
    );

    const existingCount = Number(countRes.rows[0].count);
    if (existingCount >= totalTrades) {
      await client.query('COMMIT');
      return;
    }

    if (now <= cycleStart) {
      await client.query('COMMIT');
      return;
    }

    const cycleSpanMs = cycleEnd - cycleStart;
    const intervalMs = Math.floor(cycleSpanMs / totalTrades);

    if (intervalMs <= 0) {
      await client.query('COMMIT');
      return;
    }

    const elapsedMs = now - cycleStart;
    const shouldExist = Math.floor(elapsedMs / intervalMs);
    const maxTrades = Math.min(shouldExist, totalTrades);
    const tradesToCreate = maxTrades - existingCount;

    if (tradesToCreate <= 0) {
      await client.query('COMMIT');
      return;
    }

    // 🔁 Recalculate balance from CLOSED trades only
    let balance = principal;

    const existingTrades = await client.query(
      `
      SELECT side, size, entry_price, exit_price
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      ORDER BY opened_at ASC
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

    const trades = [];

    for (let i = existingCount; i < maxTrades; i++) {

      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const entry = await fetchLatestPrice(client, symbol);
      if (!entry) continue;

      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

      const riskAmount = balance * 0.02;
      const size = riskAmount / entry;

      if (size <= 0) continue;

      const isWin = Math.random() < 0.7; // 70% fixed win rate

      const movePct = isWin
        ? randomBetween(0.003, 0.008)
        : randomBetween(0.002, 0.006);

      const exit =
        side === 'LONG'
          ? (isWin ? entry * (1 + movePct) : entry * (1 - movePct))
          : (isWin ? entry * (1 - movePct) : entry * (1 + movePct));

      const openedAt = new Date(cycleStart.getTime() + (intervalMs * i));
      const closedAt = new Date(openedAt.getTime() + 3600000);

      trades.push({
        cycle_id: lockedCycle.id,
        symbol,
        side,
        size,
        entry_price: entry,
        exit_price: exit,
        status: 'CLOSED',
        opened_at: openedAt,
        closed_at: closedAt,
        user_id: lockedCycle.user_id,
        wallet_id: lockedCycle.wallet_id,
        source: 'SIMULATION'
      });
    }

    if (!trades.length) {
      await client.query('COMMIT');
      return;
    }

    const values = [];
    const params = [];

    trades.forEach((t, i) => {
      const base = i * 12;

      values.push(
        `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12})`
      );

      params.push(
        t.cycle_id,
        t.symbol,
        t.side,
        t.size,
        t.entry_price,
        t.exit_price,
        t.status,
        t.opened_at,
        t.closed_at,
        t.user_id,
        t.wallet_id,
        t.source
      );
    });

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
      VALUES ${values.join(',')}
      `,
      params
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
