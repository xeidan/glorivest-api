'use strict';

const axios = require('axios');

const API_URL = 'https://glorivest-api-a16f75b6b330.herokuapp.com/api/market-snapshot';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

const STATIC_PRICES = {
  XAUUSD: 5065,
  EURUSD: 1.0812
};

async function fetchBinance(symbol) {
  const res = await axios.get(BINANCE_URL, {
    params: { symbol },
    timeout: 5000
  });

  const price = Number(res.data?.price);
  if (!Number.isFinite(price)) {
    throw new Error(`Invalid Binance price for ${symbol}`);
  }

  return price;
}

async function pushSnapshot(symbol, price) {
  await axios.post(API_URL, {
    symbol,
    price,
    source: 'script'
  }, { timeout: 5000 });
}

async function run() {
  for (const symbol of SYMBOLS) {
    try {
      const price = await fetchBinance(symbol);
      await pushSnapshot(symbol, price);
      console.log('pushed', symbol, price);
    } catch (err) {
      console.error('fail', symbol, err.message);
    }
  }

  for (const [symbol, price] of Object.entries(STATIC_PRICES)) {
    try {
      await pushSnapshot(symbol, price);
      console.log('pushed', symbol, price);
    } catch (err) {
      console.error('fail', symbol, err.message);
    }
  }
}

run();
