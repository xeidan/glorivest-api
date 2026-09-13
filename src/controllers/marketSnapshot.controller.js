'use strict';

const {
  getHistoricalCandles,
  getTwelveDataCandles,
  getSiftingCommodityCandles,
  toTwelveDataSymbol
} = require('../services/price.service');

/* ======================================================
   BINANCE ASSETS — CRYPTO
====================================================== */

const BINANCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'XRPUSDT',
  'SOLUSDT'
];

/* ======================================================
   TWELVE DATA ASSETS — FOREX + STOCKS
====================================================== */

const TWELVE_DATA_SYMBOLS = [
  // Forex
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
  'USDCAD',
  'USDCHF',
  'NZDUSD',
  'EURGBP',
  'EURJPY',
  'GBPJPY',

  // Stocks
  'AAPL',
  'TSLA',
  'NVDA',
  'MSFT',
  'AMZN',
  'GOOGL',
  'META',
  'NFLX',
  'AMD'
];

/* ======================================================
   SIFTINGIO ASSETS — GOLD + SILVER
====================================================== */

const SIFTING_SYMBOLS = [
  'XAUUSD',
  'XAGUSD'
];

/* ======================================================
   INTERVALS
====================================================== */

const INTERVAL_MAP = {
  '1min': '1min',
  '5min': '5min',
  '15min': '15min',
  '30min': '30min',
  '1h': '1h',
  '4h': '4h',
  '1day': '1day',
  '1week': '1week',
  '1month': '1month'
};

/* ======================================================
   SIFTINGIO INTERVAL CONVERSION
====================================================== */

function toSiftingInterval(interval) {
  const intervalMap = {
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1h': '1h',
    '4h': '4h',
    '1day': '1d',
    '1week': '1w',
    '1month': '1mo'
  };

  return intervalMap[interval] || interval;
}

/* ======================================================
   BINANCE INTERVAL CONVERSION
====================================================== */

function toBinanceInterval(interval) {
  const intervalMap = {
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1h': '1h',
    '4h': '4h',
    '1day': '1d',
    '1week': '1w',
    '1month': '1M'
  };

  return intervalMap[interval] || interval;
}

/* ======================================================
   MARKET CANDLES
====================================================== */

async function getMarketCandles(req, res) {
  try {
    const symbol = String(
      req.query.symbol || ''
    ).trim().toUpperCase();

    const requestedInterval = String(
      req.query.interval || '1min'
    ).trim().toLowerCase();

    const interval = INTERVAL_MAP[requestedInterval];

    const parsedLimit = Number.parseInt(
      req.query.limit || '100',
      10
    );

    const limit = Math.min(
      Math.max(
        Number.isFinite(parsedLimit) ? parsedLimit : 100,
        1
      ),
      1000
    );

    /* ==================================================
       VALIDATE INTERVAL
    ================================================== */

    if (!interval) {
      return res.status(400).json({
        message: `Unsupported interval ${requestedInterval}`
      });
    }

    /* ==================================================
       VALIDATE SYMBOL
    ================================================== */

    const supported =
      BINANCE_SYMBOLS.includes(symbol) ||
      SIFTING_SYMBOLS.includes(symbol) ||
      TWELVE_DATA_SYMBOLS.includes(symbol);

    if (!supported) {
      return res.status(400).json({
        message: `Unsupported market symbol ${symbol}`
      });
    }

    /* ==================================================
       BINANCE — CRYPTO
    ================================================== */

    if (BINANCE_SYMBOLS.includes(symbol)) {
      const binanceInterval =
        toBinanceInterval(interval);

      const candles =
        await getHistoricalCandles(
          symbol,
          binanceInterval,
          limit
        );

      return res.json({
        symbol,
        provider: 'BINANCE',
        interval: requestedInterval,
        candles
      });
    }

    /* ==================================================
       SIFTINGIO — GOLD + SILVER
    ================================================== */

    if (SIFTING_SYMBOLS.includes(symbol)) {
      const siftingInterval =
        toSiftingInterval(interval);

      const candles =
        await getSiftingCommodityCandles(
          symbol,
          siftingInterval,
          limit
        );

      return res.json({
        symbol,
        provider: 'SIFTINGIO',
        interval: requestedInterval,
        candles
      });
    }

    /* ==================================================
       TWELVE DATA — FOREX + STOCKS
    ================================================== */

    if (TWELVE_DATA_SYMBOLS.includes(symbol)) {
      const twelveSymbol =
        toTwelveDataSymbol(symbol);

      const candles =
        await getTwelveDataCandles(
          twelveSymbol,
          interval,
          limit
        );

      return res.json({
        symbol,
        provider: 'TWELVE_DATA',
        interval: requestedInterval,
        candles
      });
    }

    /* ==================================================
       FALLBACK
    ================================================== */

    return res.status(400).json({
      message: `Unsupported market symbol ${symbol}`
    });

  } catch (err) {
    console.error(
      '❌ getMarketCandles error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load market candles'
    });
  }
}

module.exports = {
  getMarketCandles
};