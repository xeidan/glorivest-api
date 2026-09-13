async function getMarketCandles(req, res) {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase();
    const interval = String(req.query.interval || '1min').toLowerCase();
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit || '100', 10), 1),
      500
    );

    const supportedSymbols = Object.keys(MAX_REASONABLE_PRICES);
    const supportedIntervals = ['1min'];

    if (!supportedSymbols.includes(symbol)) {
      return res.status(400).json({
        message: `Unsupported symbol ${symbol}`
      });
    }

    if (!supportedIntervals.includes(interval)) {
      return res.status(400).json({
        message: `Unsupported interval ${interval}`
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        recorded_at,
        price
      FROM market_prices
      WHERE symbol = $1
      ORDER BY recorded_at DESC
      LIMIT $2
      `,
      [symbol, limit]
    );

    /*
     * Convert market snapshots into 1-minute OHLC candles.
     */
    const candles = new Map();

    for (const row of rows) {
      const timestamp = new Date(row.recorded_at);
      const price = Number(row.price);

      if (!Number.isFinite(price)) continue;

      const minute = new Date(
        Math.floor(timestamp.getTime() / 60_000) * 60_000
      );

      const key = minute.getTime();

      if (!candles.has(key)) {
        candles.set(key, {
          time: Math.floor(key / 1000),
          open: price,
          high: price,
          low: price,
          close: price
        });
      } else {
        const candle = candles.get(key);

        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);

        // Because rows are newest -> oldest,
        // the first price encountered is the close.
        candle.open = price;
      }
    }

    const result = Array.from(candles.values())
      .sort((a, b) => a.time - b.time)
      .slice(-limit);

    return res.json({
      symbol,
      interval,
      candles: result
    });

  } catch (err) {
    console.error('❌ getMarketCandles error:', err);

    return res.status(500).json({
      message: 'Failed to load market candles'
    });
  }
}

module.exports = {
  recordMarketSnapshot,
  getMarketCandles
};