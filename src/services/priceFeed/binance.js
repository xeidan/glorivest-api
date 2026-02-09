'use strict';

async function getBinancePrice(symbol) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  );
  const data = await res.json();

  if (!data.price) {
    throw new Error(`Binance price error for ${symbol}`);
  }

  return Number(data.price);
}

module.exports = { getBinancePrice };
