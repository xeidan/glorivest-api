'use strict';

async function getFxPrice(symbol) {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);

  const res = await fetch(
    `https://api.exchangerate.host/latest?base=${base}&symbols=${quote}`
  );
  const data = await res.json();

  const rate = data?.rates?.[quote];

  if (!rate) {
    throw new Error(`FX price error for ${symbol}`);
  }

  return Number(rate);
}

module.exports = { getFxPrice };
