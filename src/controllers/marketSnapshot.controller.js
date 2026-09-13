'use strict';

const {
  getHistoricalCandles,
  getTwelveDataCandles,
  getSiftingSilverCandles,
  toTwelveDataSymbol
} = require('../services/price.service');

/* ======================================================
   BINANCE ASSETS
====================================================== */

const BINANCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'XRPUSDT',
  'SOLUSDT'
];

/* ======================================================
   TWELVE DATA ASSETS
====================================================== */

const TWELVE_DATA_SYMBOLS = [
  // Gold
  'XAUUSD',

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
   SIFTINGIO ASSETS
====================================================== */

const SIFTING_SYMBOLS = [
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
   MARKET CANDLES
====================================================== */

async function getMarketCandles(req, res) {
  try {
    const symbol = String(
      req.query.symbol || ''
    ).toUpperCase();

    const requestedInterval = String(
      req.query.interval || '1min'
    ).toLowerCase();

    const interval =
      INTERVAL_MAP[requestedInterval];

    const limit = Math.min(
      Math.max(
        Number.parseInt(
          req.query.limit || '100',
          10
        ),
        1
      ),
      1000
    );

    if (!interval) {
      return res.status(400).json({
        message:
          `Unsupported interval ${requestedInterval}`
      });
    }

    /* ==================================================
       BINANCE — CRYPTO
    ================================================== */

    if (BINANCE_SYMBOLS.includes(symbol)) {
      const binanceInterval =
        interval === '1day'
          ? '1d'
          : interval === '1week'
            ? '1w'
            : interval === '1month'
              ? '1M'
              : interval;

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
       SIFTINGIO — SILVER
    ================================================== */

    if (SIFTING_SYMBOLS.includes(symbol)) {
      const siftingInterval =
        interval === '1min'
          ? '1m'
          : interval === '5min'
            ? '5m'
            : interval === '15min'
              ? '15m'
              : interval === '30min'
                ? '30m'
                : interval === '1h'
                  ? '1h'
                  : interval === '4h'
                    ? '4h'
                    : interval === '1day'
                      ? '1d'
                      : interval === '1week'
                        ? '1w'
                        : interval === '1month'
                          ? '1mo'
                          : interval;

      const candles =
        await getSiftingSilverCandles(
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
       TWELVE DATA — GOLD + STOCKS
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
       UNSUPPORTED
    ================================================== */

    return res.status(400).json({
      message:
        `Unsupported market symbol ${symbol}`
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