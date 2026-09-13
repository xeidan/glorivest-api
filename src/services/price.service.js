'use strict';

const fetch = require('node-fetch');

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';

async function getLatestPrice(symbol) {
  const res = await fetch(
    `${BINANCE_BASE_URL}/ticker/price?symbol=${encodeURIComponent(symbol)}`
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

async function getHistoricalCandles(
  symbol,
  interval = '1m',
  limit = 100
) {
  const allowedIntervals = [
    '1m',
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
    '1w',
    '1M'
  ];

  if (!allowedIntervals.includes(interval)) {
    throw new Error(`Unsupported Binance interval: ${interval}`);
  }

  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    1000
  );

  const url =
    `${BINANCE_BASE_URL}/klines` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${safeLimit}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Binance candles request failed: ${res.status}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error(`Invalid Binance candles response for ${symbol}`);
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