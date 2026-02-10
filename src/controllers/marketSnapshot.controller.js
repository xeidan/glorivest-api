'use strict';

const fetch = require('node-fetch');
const { pool } = require('../config/database');

const MIN_INTERVAL_MS = 5000;

/* ===============================
   LIVE PRICE FETCHERS
================================ */

async function fetchLivePrice(symbol) {
  // CRYPTO (Binance)
  if (symbol.endsWith('USDT')) {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
    );
    if (!res.ok) throw new Error('Binance price fetch failed');
    const data = await res.json();
    return Number(data.price);
  }

  // FX / METALS (fallback – you can replace provider later)
  const res = await fetch(
    `https://api.exchangerate.host/latest?base=${symbol.slice(0,3)}&symbols=${symbol.slice(3)}`
  );
  if (!res.ok) throw new Error('FX price fetch failed');
  const data = await res.json();
  return Number(data.rates[symbol.slice(3)]);
}

/* ===============================
   SNAPSHOT CONTROLLER
================================ */

async function recordMarketSnapshot(req, res) {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({ message: 'Symbol required' });
    }

    // throttle
    const { rows } = await pool.query(
      `
      SELECT recorded_at
      FROM market_prices
      WHERE symbol = $1
      ORDER BY recorded_at DESC
      LIMIT 1
      `,
      [symbol]
    );

    if (rows.length) {
      const last = new Date(rows[0].recorded_at).getTime();
      if (Date.now() - last < MIN_INTERVAL_MS) {
        return res.json({ ok: true, skipped: true });
      }
    }

    // 🔥 FETCH REAL PRICE
    const price = await fetchLivePrice(symbol);

    if (!Number.isFinite(price)) {
      throw new Error('Invalid live price');
    }

    await pool.query(
      `INSERT INTO market_prices (symbol, price) VALUES ($1,$2)`,
      [symbol, price]
    );

    return res.json({ ok: true, symbol, price });

  } catch (err) {
    console.error('❌ recordMarketSnapshot error:', err.message);
    return res.status(500).json({ message: 'Snapshot failed' });
  }
}

module.exports = {
  recordMarketSnapshot
};
