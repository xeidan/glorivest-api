'use strict';

const { pool } = require('../config/database');

const SYMBOLS = ['BTCUSDT','ETHUSDT','XAUUSD','EURUSD'];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function tradesPerDay(duration) {
  if (duration === 30) return Math.floor(randomBetween(6, 8));
  if (duration === 90) return 4;
  if (duration === 180) return 3;
  return 3;
}

async function fetchLatestPrice(symbol) {
  const res = await pool.query(
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

  const totalTrades =
    tradesPerDay(cycle.duration_days) * cycle.duration_days;

  const winCount = Math.floor(totalTrades * 0.7);
  const lossCount = totalTrades - winCount;

  const outcomes = shuffle([
    ...Array(winCount).fill('win'),
    ...Array(lossCount).fill('loss')
  ]);

  let balance = Number(cycle.principal_amount);

  const trades = [];

  for (let i = 0; i < totalTrades; i++) {

    const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const entry = await fetchLatestPrice(symbol);
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
      exit =
        outcome === 'win'
          ? entry * (1 + movePct)
          : entry * (1 - movePct);
    } else {
      exit =
        outcome === 'win'
          ? entry * (1 - movePct)
          : entry * (1 + movePct);
    }

    const pnl =
      side === 'LONG'
        ? (exit - entry) * size
        : (entry - exit) * size;

    balance += pnl;

    const openedAt = new Date();
    const closedAt = new Date(openedAt.getTime() + 60 * 60 * 1000);

    trades.push({
      user_id: cycle.user_id,
      wallet_id: cycle.wallet_id,
      cycle_id: cycle.id,
      symbol,
      side,
      size,
      entry_price: entry,
      exit_price: exit,
      status: 'CLOSED',
      opened_at: openedAt,
      closed_at: closedAt,
      source: 'SIMULATION'
    });
  }

  if (!trades.length) return;

  const values = [];
  const params = [];

  trades.forEach((t, i) => {
    const idx = i * 12;

    values.push(
      `($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10},$${idx+11},$${idx+12})`
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

  await pool.query(
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
}

module.exports = { generateTradesForCycle };
