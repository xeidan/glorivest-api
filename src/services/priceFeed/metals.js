'use strict';

async function getMetalPrice(symbol) {
  // Using USD metals via exchangerate.host
  const metal = symbol === 'XAUUSD' ? 'XAU' : 'XAG';

  const res = await fetch(
    `https://api.exchangerate.host/latest?base=${metal}&symbols=USD`
  );
  const data = await res.json();

  const price = data?.rates?.USD;

  if (!price) {
    throw new Error(`Metal price error for ${symbol}`);
  }

  return Number(price);
}

module.exports = { getMetalPrice };
