'use strict';

const { getCurrentPrice } = require('../priceFeed/binance');

async function openPosition({ client, wallet, cycle, symbol, side, riskPct }) {
  const entryPrice = await getCurrentPrice(symbol);

  const riskCents = Math.floor(
    wallet.balance_cents * (riskPct / 100)
  );

  const size =
    (riskCents / 100) / entryPrice;

  const { rows } = await client.query(
    `
    INSERT INTO positions (
      user_id,
      wallet_id,
      cycle_id,
      symbol,
      side,
      size,
      entry_price,
      status,
      opened_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',NOW())
    RETURNING *
    `,
    [
      wallet.user_id,
      wallet.id,
      cycle.id,
      symbol,
      side,
      size,
      entryPrice
    ]
  );

  return rows[0];
}

async function closePosition({ client, position }) {
  const exitPrice = await getCurrentPrice(position.symbol);

  const pnl =
    (exitPrice - position.entry_price) *
    position.size *
    100 *
    (position.side === 'LONG' ? 1 : -1);

  const pnlCents = Math.round(pnl);

  await client.query(
    `
    UPDATE positions
    SET
      exit_price = $1,
      pnl_cents = $2,
      status = 'CLOSED',
      closed_at = NOW()
    WHERE id = $3
    `,
    [exitPrice, pnlCents, position.id]
  );

  return pnlCents;
}

module.exports = { openPosition, closePosition };
