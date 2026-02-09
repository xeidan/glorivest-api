'use strict';

const axios = require('axios');

const API_URL = 'https://glorivest-api-a16f75b6b330.herokuapp.com/api/market-snapshot';

const SNAPSHOTS = [
  { symbol: 'BTCUSDT', price: 50650 },
  { symbol: 'ETHUSDT', price: 2890 },
  { symbol: 'XAUUSD', price: 5065 },
  { symbol: 'EURUSD', price: 1.0812 }
];

async function run() {
  for (const s of SNAPSHOTS) {
    try {
      await axios.post(API_URL, s);
      console.log('pushed', s.symbol);
    } catch (e) {
      console.error('fail', s.symbol, e.message);
    }
  }
}

run();
