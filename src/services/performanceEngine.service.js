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

  if (!cycle) throw new Error('Cycle missing');
  if (!cycle.id) throw new Error('Cycle id missing');
  if (!cycle.user_id) throw new Error('Cycle user_id missing');
  if (!cycle.wallet_id) throw new Error('Cycle wallet_id missing');
  if (!cycle.duration_days) throw new Error('Cycle duration_days missing');
  if (!cycle.capital_amount) throw new Error('Cycle capital_amount missing');
  if (!cycle.start_at) throw new Error('Cycle start_at missing');

  const duration = Number(cycle.duration_days);
  const principal = Number(cycle.capital_amount);
  const cycleStart = new Date(cycle.start_at);
  const cycleEnd = new Date(cycle.end_at);

  const totalTrades = tradesPerDay(duration) * duration;
  if (totalTrades <= 0) return;

  const client = await pool.connect();

  try {

    const existing = await client.query(
      `SELECT COUNT(*) FROM positions WHERE cycle_id = $1`,
      [cycle.id]
    );

    if (Number(existing.rows[0].count) > 0) {
      return; // already generated
    }

    const winCount = Math.floor(totalTrades * 0.7);
    const lossCount = totalTrades - winCount;

    const outcomes = shuffle([
      ...Array(winCount).fill('win'),
      ...Array(lossCount).fill('loss')
    ]);

    let balance = principal;

    const cycleSpanMs = cycleEnd.getTime() - cycleStart.getTime();
    const intervalMs = Math.floor(cycleSpanMs / totalTrades);

    const trades = [];

    for (let i = 0; i < totalTrades; i++) {

      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const entry = await fetchLatestPrice(client, symbol);
      if (!entry) continue;

      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

      const riskAmount = balance * 0.02;
      const size = riskAmount / entry;

      const outcome = outcomes[i];

      const movePct =
        outcome === 'win'
          ? randomBetween(0.003, 0.008)
          : randomBetween(0.002, 0.006);

      let exit;

      if (side === 'LONG') {
        exit = outcome === 'win'
          ? entry * (1 + movePct)
          : entry * (1 - movePct);
      } else {
        exit = outcome === 'win'
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

  } finally {
    client.release();
  }
}

module.exports = { generateTradesForCycle };
