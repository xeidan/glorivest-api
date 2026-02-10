'use strict';

const { pool } = require('../config/database');

const MIN_INTERVAL_MS = 5000;

/* ===============================
   LIVE PRICE (BINANCE ONLY)
================================ */

async function fetchLivePrice(symbol) {
  // Node 18+ has global fetch — DO NOT use node-fetch
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  );

  if (!res.ok) {
    throw new Error(`Binance fetch failed for ${symbol}`);
  }

  const data = await res.json();
  const price = Number(data.price);

  if (!Number.isFinite(price)) {
    throw new Error(`Invalid price from Binance for ${symbol}`);
  }

  return price;
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

    // 🚫 TEMPORARILY BLOCK NON-BINANCE SYMBOLS
    if (!symbol.endsWith('USDT')) {
      return res.status(400).json({
        message: 'Only Binance USDT pairs supported for now'
      });
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

    // 🔥 REAL PRICE
    const price = await fetchLivePrice(symbol);

    await pool.query(
      `INSERT INTO market_prices (symbol, price) VALUES ($1,$2)`,
      [symbol, price]
    );

    return res.json({ ok: true, symbol, price });

  } catch (err) {
    console.error('❌ snapshot error:', err.message);
    return res.status(500).json({ message: err.message });
  }
}

module.exports = { recordMarketSnapshot };
