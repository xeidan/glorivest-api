'use strict';

const fetch = require('node-fetch');

const BINANCE_API = 'https://api.binance.com';
const BINANCE_DATA_API = 'https://data-api.binance.vision';

const TWELVE_DATA_API = 'https://api.twelvedata.com';
const SIFTING_API = 'https://api.sifting.io';

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const SIFTING_API_KEY = process.env.SIFTING_API_KEY;

/* ======================================================
   BINANCE
====================================================== */

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
      `Binance candles request failed: ${res.status}` +
      `${body ? ` - ${body}` : ''}`
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

/* ======================================================
   TWELVE DATA
====================================================== */

async function getTwelveDataCandles(
  symbol,
  interval,
  limit = 100
) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error(
      'TWELVE_DATA_API_KEY is not configured'
    );
  }

  const url =
    `${TWELVE_DATA_API}/time_series` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${limit}` +
    `&timezone=UTC` +
    `&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Glorivest/1.0'
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Twelve Data request failed: ${res.status}`
    );
  }

  if (data.status === 'error') {
    throw new Error(
      data.message || 'Twelve Data request failed'
    );
  }

  if (!Array.isArray(data.values)) {
    throw new Error(
      `No candle data returned for ${symbol}`
    );
  }

  const candles = data.values
    .map(row => ({
      time: Math.floor(
        new Date(`${row.datetime}Z`).getTime() / 1000
      ),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume != null
        ? Number(row.volume)
        : 0
    }))
    .filter(candle =>
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
    )
    .sort((a, b) => a.time - b.time);

  if (!candles.length) {
    throw new Error(
      `No valid candles returned for ${symbol}`
    );
  }

  return candles;
}

/* ======================================================
   SIFTINGIO — SILVER
====================================================== */

async function getSiftingSilverCandles(
  interval,
  limit = 100
) {
  if (!SIFTING_API_KEY) {
    throw new Error(
      'SIFTING_API_KEY is not configured'
    );
  }

  /*
   * SiftingIO requires a start date.
   *
   * We request a sufficiently wide historical window
   * and then keep the latest `limit` candles.
   */

  const startDate = new Date();

  startDate.setUTCDate(
    startDate.getUTCDate() - 30
  );

  const start =
    startDate.toISOString();

  const url =
    `${SIFTING_API}/v1/hist/commodities/XAGUSD/bars` +
    `?interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}` +
    `&start=${encodeURIComponent(start)}`;

  const res = await fetch(url, {
    headers: {
      'X-API-Key': SIFTING_API_KEY,
      'Accept-Encoding': 'gzip',
      'User-Agent': 'Glorivest/1.0'
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `SiftingIO candles request failed: ${res.status}` +
      `${data?.error ? ` - ${data.error}` : ''}`
    );
  }

  /*
   * SiftingIO response validation.
   */
  const rows =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.bars)
          ? data.bars
          : [];

  if (!rows.length) {
    throw new Error(
      'No Silver candles returned by SiftingIO'
    );
  }

  const candles = rows
    .map(row => {
      const timeValue =
        row.time ??
        row.timestamp ??
        row.datetime ??
        row.t;

      return {
        time: normalizeTimestamp(timeValue),
        open: Number(row.open ?? row.o),
        high: Number(row.high ?? row.h),
        low: Number(row.low ?? row.l),
        close: Number(row.close ?? row.c),
        volume: Number(
          row.volume ??
          row.v ??
          0
        )
      };
    })
    .filter(candle =>
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
    )
    .sort((a, b) => a.time - b.time);

  if (!candles.length) {
    throw new Error(
      'No valid Silver candles returned by SiftingIO'
    );
  }

  return candles.slice(-limit);
}

/* ======================================================
   TIMESTAMP NORMALIZER
====================================================== */

function normalizeTimestamp(value) {
  if (typeof value === 'number') {
    /*
     * Handle milliseconds vs seconds.
     */
    return value > 100000000000
      ? Math.floor(value / 1000)
      : Math.floor(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return numeric > 100000000000
        ? Math.floor(numeric / 1000)
        : Math.floor(numeric);
    }

    const parsed =
      new Date(value).getTime();

    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return NaN;
}

/* ======================================================
   SYMBOL HELPERS
====================================================== */

function toTwelveDataSymbol(symbol) {
  const normalized = String(symbol)
    .trim()
    .toUpperCase();

  const symbolMap = {
    XAUUSD: 'XAU/USD',
    XAGUSD: 'XAG/USD'
  };

  return symbolMap[normalized] || normalized;
}

/* ======================================================
   EXPORTS
====================================================== */

module.exports = {
  getLatestPrice,
  getHistoricalCandles,
  getTwelveDataCandles,
  getSiftingSilverCandles,
  toTwelveDataSymbol
};