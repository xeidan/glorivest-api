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

  const duration = Number(cycle.duration_days);
  const principal = Number(cycle.capital_amount);
  const cycleStart = new Date(cycle.start_at);
  const cycleEnd = new Date(cycle.end_at);

  const totalTrades = tradesPerDay(duration) * duration;
  if (totalTrades <= 0) return;

  const client = await pool.connect();

  try {

    const existingRes = await client.query(
      `SELECT COUNT(*) FROM positions WHERE cycle_id = $1`,
      [cycle.id]
    );

    const existingCount = Number(existingRes.rows[0].count);

    const cycleSpanMs = cycleEnd.getTime() - cycleStart.getTime();
    const intervalMs = Math.floor(cycleSpanMs / totalTrades);

    const now = new Date();

    if (now <= cycleStart) return;
    if (cycle.status !== 'active') return;

    const elapsedMs = now.getTime() - cycleStart.getTime();
    const shouldExist = Math.floor(elapsedMs / intervalMs);

    const maxTrades = Math.min(shouldExist, totalTrades);

    const tradesToCreate = maxTrades - existingCount;

    if (tradesToCreate <= 0) return;

    let balance = principal;

    // Recalculate balance from existing trades
    const existingTrades = await client.query(
      `
      SELECT
        side,
        size,
        entry_price,
        exit_price
      FROM positions
      WHERE cycle_id = $1
      ORDER BY opened_at ASC
      `,
      [cycle.id]
    );

    for (const t of existingTrades.rows) {
      const pnl =
        t.side === 'LONG'
          ? (t.exit_price - t.entry_price) * t.size
          : (t.entry_price - t.exit_price) * t.size;

      balance += Number(pnl);
    }

    const trades = [];

    for (let i = existingCount; i < maxTrades; i++) {

      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const entry = await fetchLatestPrice(client, symbol);
      if (!entry) continue;

      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

      const riskAmount = balance * 0.02;
      const size = riskAmount / entry;

      const isWin = Math.random() < 0.7;

      const movePct =
        isWin
          ? randomBetween(0.003, 0.008)
          : randomBetween(0.002, 0.006);

      let exit;

      if (side === 'LONG') {
        exit = isWin
          ? entry * (1 + movePct)
          : entry * (1 - movePct);
      } else {
        exit = isWin
          ? entry * (1 - movePct)
          : entry * (1 + movePct);
      }

      const pnl =
        side === 'LONG'
          ? (exit - entry) * size
          : (entry - exit) * size;

      balance += pnl;

      const openedAt = new Date(cycleStart.getTime() + (intervalMs * i));
      const closedAt = new Date(openedAt.getTime() + 3600000);

      trades.push({
        cycle_id: cycle.id,
        symbol,
        side,
        size,
        entry_price: entry,
        exit_price: exit,
        status: 'CLOSED',
        opened_at: openedAt,
        closed_at: closedAt,
        user_id: cycle.user_id,
        wallet_id: cycle.wallet_id,
        source: 'SIMULATION'
      });
    }

    if (!trades.length) return;

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

    // Update accrued_profit
const profitRes = await client.query(
  `
  SELECT
    COALESCE(SUM(
      CASE
        WHEN side = 'LONG'
          THEN (exit_price - entry_price) * size
        WHEN side = 'SHORT'
          THEN (entry_price - exit_price) * size
        ELSE 0
      END
    ), 0) AS total_profit
  FROM positions
  WHERE cycle_id = $1
  `,
  [cycle.id]
);

const totalProfit = Number(profitRes.rows[0].total_profit);

await client.query(
  `
  UPDATE investment_cycles
  SET accrued_profit = $1,
      updated_at = NOW()
  WHERE id = $2
  `,
  [totalProfit, cycle.id]
);


  } finally {
    client.release();
  }
}


module.exports = { generateTradesForCycle };
