'use strict';

const https = require('https');

async function getBinancePrice(symbol) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 Glorivest/1.0',
          'Accept': 'application/json'
        },
        timeout: 5000
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.price) {
              return reject(new Error(`Binance invalid response`));
            }
            resolve(Number(json.price));
          } catch {
            reject(new Error(`Binance parse error`));
          }
        });
      }
    );

    req.on('error', () => reject(new Error(`Binance network error`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Binance timeout`));
    });
  });
}

module.exports = { getBinancePrice };
