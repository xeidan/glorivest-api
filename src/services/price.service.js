// src/services/price.service.js
const fetch = require('node-fetch');

async function getLatestPrice(symbol) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  );
  const data = await res.json();
  return Number(data.price);
}

module.exports = { getLatestPrice };
