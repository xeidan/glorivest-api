'use strict';

const {
  getHistoricalCandles
} = require('../services/price.service');

/*
|--------------------------------------------------------------------------
| SUPPORTED MARKET SYMBOLS
|--------------------------------------------------------------------------
*/

const SUPPORTED_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT'
];

/*
|--------------------------------------------------------------------------
| GET MARKET CANDLES
|--------------------------------------------------------------------------
|
| Returns real historical OHLC candles from Binance.
|
*/

async function getMarketCandles(req, res) {
  try {
    const symbol = String(
      req.query.symbol || ''
    ).toUpperCase();

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

    const requestedInterval = String(
      req.query.interval || '1min'
    ).toLowerCase();

    const interval =
      intervalMap[requestedInterval];

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

    if (!SUPPORTED_SYMBOLS.includes(symbol)) {
      return res.status(400).json({
        message: `Unsupported symbol ${symbol}`
      });
    }

    if (!interval) {
      return res.status(400).json({
        message:
          `Unsupported interval ${requestedInterval}`
      });
    }

    const candles = await getHistoricalCandles(
      symbol,
      interval,
      limit
    );

    return res.json({
      symbol,
      interval: requestedInterval,
      candles
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