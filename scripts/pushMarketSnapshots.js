'use strict';

const axios = require('axios');

const API_URL =
  'https://glorivest-api-a16f75b6b330.herokuapp.com/api/market-snapshot';

const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'XAUUSD',
  'EURUSD'
];

async function run() {
  for (const symbol of SYMBOLS) {
    try {
      await axios.post(API_URL, { symbol });
      console.log('pushed', symbol);
    } catch (e) {
      console.error('fail', symbol, e.response?.data || e.message);
    }
  }
}

run();
