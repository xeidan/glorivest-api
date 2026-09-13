// src/services/price.service.js

'use strict';

const fetch = require('node-fetch');

const BINANCE_API = 'https://api.binance.com';
const BINANCE_DATA_API = 'https://data-api.binance.vision';

async function getLatestPrice(symbol) {
  const res = await fetch(
    `${BINANCE_API}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
  );

  if (!res.ok) {
    throw new Error(`Binance price request failed: ${res.status}`);
  }

  const data = await res.json();
  const price = Number(data.price);

  if (!Number.isFinite(price)) {
    throw new Error(`Invalid Binance price for ${symbol}`);
  }

  return price;
}

async function getHistoricalCandles(symbol, interval, limit = 100) {
  const url =
    `${BINANCE_DATA_API}/api/v3/klines` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Glorivest/1.0'
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Binance candles request failed: ${res.status}${body ? ` - ${body}` : ''}`
    );
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error('Invalid Binance candles response');
  }

  return data.map(candle => ({
    time: Math.floor(Number(candle[0]) / 1000),
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5])
  }));
}

module.exports = {
  getLatestPrice,
  getHistoricalCandles
};