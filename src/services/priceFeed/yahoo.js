'use strict';

async function getYahooPrice(symbol) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`
  );
  const data = await res.json();

  const price =
    data?.quoteResponse?.result?.[0]?.regularMarketPrice;

  if (!price) {
    throw new Error(`Yahoo price error for ${symbol}`);
  }

  return Number(price);
}

module.exports = { getYahooPrice };
