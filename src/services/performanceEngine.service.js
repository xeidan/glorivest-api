'use strict';

const { pool } = require('../config/database');

const SYMBOLS = {
  crypto: ['BTCUSDT','ETHUSDT'],
  forex: ['EURUSD'],
  metals: ['XAUUSD']
};

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function tradesPerDay(duration) {
  if (duration === 30) return randomInt(6,7);
  if (duration === 90) return 4;
  if (duration === 180) return 3;
  return 3;
}

function getRandomSymbol(date) {
  // Forex & gold skip weekends
  if (isWeekend(date)) {
    return SYMBOLS.crypto[randomInt(0, SYMBOLS.crypto.length - 1)];
  }

  const pools = [
    ...SYMBOLS.crypto,
    ...SYMBOLS.forex,
    ...SYMBOLS.metals
  ];

  return pools[randomInt(0, pools.length - 1)];
}

function getTradingHour(symbol) {
  if (SYMBOLS.crypto.includes(symbol)) {
    return randomInt(0, 23);
  }

  // Forex & Gold sessions (London + NY overlap)
  return randomInt(7, 17);
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

function generateIntradayTimestamp(baseDate, symbol) {
  const open = new Date(baseDate);

  open.setHours(getTradingHour(symbol));
  open.setMinutes(randomInt(0,59));
  open.setSeconds(randomInt(0,59));

  const holdMinutes = randomInt(20, 240);
  const close = new Date(open.getTime() + holdMinutes * 60000);

  return { open, close };
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
  const initialBalance = balance;
  const targetProfit = Number(cycle.expected_profit);

  const trades = [];
  const startDate = new Date(cycle.start_at);

  let tradeIndex = 0;
  let peakBalance = balance;
  const maxDrawdownPct = 0.15; // 15% max equity drop

  for (let d = 0; d < cycle.duration_days; d++) {

    const dayDate = new Date(startDate.getTime() + d * 86400000);
    const tradesToday = tradesPerDay(cycle.duration_days);

    for (let t = 0; t < tradesToday; t++) {

      if (tradeIndex >= totalTrades) break;

      const symbol = getRandomSymbol(dayDate);
      const entry = await fetchLatestPrice(symbol);
      if (!entry) continue;

      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

      // Equity smoothing (reduce risk early, increase gradually)
      const growthFactor = balance / initialBalance;
      const dynamicRisk =
        growthFactor < 1.3 ? 0.015 :
        growthFactor < 1.7 ? 0.02 :
        0.025;

      const riskAmount = balance * dynamicRisk;
      const size = riskAmount / entry;

      const outcome = outcomes[tradeIndex];

      // Volatility-based moves
      let movePct;

      if (SYMBOLS.crypto.includes(symbol)) {
        movePct =
          outcome === 'win'
            ? randomBetween(0.004, 0.012)
            : randomBetween(0.003, 0.008);
      } else {
        movePct =
          outcome === 'win'
            ? randomBetween(0.002, 0.006)
            : randomBetween(0.0015, 0.004);
      }

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

      let pnl =
        side === 'LONG'
          ? (exit - entry) * size
          : (entry - exit) * size;

      // Drawdown protection
      const projectedBalance = balance + pnl;
      const drawdown = (peakBalance - projectedBalance) / peakBalance;

      if (drawdown > maxDrawdownPct) {
        pnl = Math.abs(pnl) * 0.5; // soften loss
        exit =
          side === 'LONG'
            ? entry * (1 - movePct * 0.5)
            : entry * (1 + movePct * 0.5);
      }

      balance += pnl;

      if (balance > peakBalance) peakBalance = balance;

      const timestamps = generateIntradayTimestamp(dayDate, symbol);

      trades.push({
        user_id: cycle.user_id,
        cycle_id: cycle.id,
        symbol,
        side,
        size,
        entry_price: entry,
        exit_price: exit,
        status: 'CLOSED',
        opened_at: timestamps.open,
        closed_at: timestamps.close,
        pnl
      });

      tradeIndex++;
    }
  }

  // Final target correction (smooth, not spike)
  const totalGenerated = trades.reduce((a, t) => a + t.pnl, 0);
  const diff = targetProfit - totalGenerated;

  if (trades.length) {
    const last = trades[trades.length - 1];
    const adjustment = diff / last.size;
    last.exit_price += adjustment;
  }

  // Bulk insert
  const values = [];
  const params = [];

  trades.forEach((t, i) => {
    const idx = i * 10;

    values.push(
      `($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10})`
    );

    params.push(
      t.user_id,
      t.cycle_id,
      t.symbol,
      t.side,
      t.size,
      t.entry_price,
      t.exit_price,
      t.status,
      t.opened_at,
      t.closed_at
    );
  });

  if (values.length) {
    await pool.query(
      `
      INSERT INTO positions
      (
        user_id,
        cycle_id,
        symbol,
        side,
        size,
        entry_price,
        exit_price,
        status,
        opened_at,
        closed_at
      )
      VALUES ${values.join(',')}
      `,
      params
    );
  }
}

module.exports = { generateTradesForCycle };
