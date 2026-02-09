'use strict';

const { getBinancePrice } = require('./binance');
const { getYahooPrice } = require('./yahoo');
const { getFxPrice } = require('./fx');
const { getMetalPrice } = require('./metals');

function classifySymbol(symbol) {
  // CRYPTO (Binance)
  if (symbol.endsWith('USDT')) return 'CRYPTO';

  // STOCKS
  if (['AAPL','TSLA','MSFT','NVDA'].includes(symbol)) return 'STOCK';

  // FOREX
  if (/^[A-Z]{6}$/.test(symbol)) return 'FOREX';

  // METALS
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') return 'METAL';

  throw new Error(`Unsupported symbol: ${symbol}`);
}

async function getPrice(symbol) {
  const type = classifySymbol(symbol);

  switch (type) {
    case 'CRYPTO':
      return getBinancePrice(symbol);

    case 'STOCK':
      return getYahooPrice(symbol);

    case 'FOREX':
      return getFxPrice(symbol);

    case 'METAL':
      return getMetalPrice(symbol);

    default:
      throw new Error(`No price handler for ${symbol}`);
  }
}

module.exports = { getPrice };
