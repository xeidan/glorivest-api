'use strict';

async function getFxPrice(symbol) {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);

  // Always query USD base for stability
  const res = await fetch(
    `https://api.exchangerate.host/latest?base=USD&symbols=${base},${quote}`
  );

  const data = await res.json();

  const rates = data?.rates;
  if (!rates) {
    throw new Error(`FX feed unavailable`);
  }

  if (base === 'USD') {
    return Number(rates[quote]);
  }

  if (quote === 'USD') {
    return 1 / Number(rates[base]);
  }

  // Cross-rate via USD
  return Number(rates[quote]) / Number(rates[base]);
}

module.exports = { getFxPrice };
