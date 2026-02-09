'use strict';

function simulateStrategy({
  capitalCents,
  config
}) {
  const {
    target_daily_return_pct,
    max_positions_per_day,
    risk_per_position_pct,
    variance_pct
  } = config;

  // 1. Daily target (capital-scaled)
  const targetPnlCents = Math.round(
    capitalCents * (target_daily_return_pct / 100)
  );

  // 2. Number of positions (bounded randomness)
  const positionCount =
    Math.max(1, Math.floor(Math.random() * max_positions_per_day) + 1);

  // 3. Split PnL across positions
  const basePnl = Math.floor(targetPnlCents / positionCount);
  let remaining = targetPnlCents;

  const positions = [];

  for (let i = 0; i < positionCount; i++) {
    const variance =
      Math.floor(basePnl * (variance_pct / 100));

    const pnl =
      i === positionCount - 1
        ? remaining
        : basePnl +
          Math.floor(Math.random() * variance * 2 - variance);

    remaining -= pnl;

    const entryPrice = randomPrice();
    const size =
      (capitalCents * (risk_per_position_pct / 100)) /
      entryPrice / 100;

    positions.push({
      symbol: randomSymbol(),
      side: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      entry_price: entryPrice,
      exit_price: entryPrice + pnlToPriceDelta(pnl, size),
      size,
      pnl_cents: pnl
    });
  }

  return {
    total_pnl_cents: targetPnlCents,
    positions
  };
}

/* helpers */
function randomSymbol() {
  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
  return symbols[Math.floor(Math.random() * symbols.length)];
}

function randomPrice() {
  return Math.floor(1000 + Math.random() * 40000);
}

function pnlToPriceDelta(pnlCents, size) {
  return size === 0 ? 0 : (pnlCents / 100) / size;
}

module.exports = { simulateStrategy };
