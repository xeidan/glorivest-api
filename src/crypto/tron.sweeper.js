// src/crypto/tron.sweeper.js
'use strict';

const { pool } = require('../config/database');
const { getUsdtBalance, sendFromPrivateKey } = require('./tron');
const { decrypt } = require('../utils/crypto');
const { OMNIBUS_TRON_ADDRESS } = require('../config/env');

exports.runSweeper = async () => {
  const { rows } = await pool.query(`
    SELECT id, address, priv_enc
    FROM wallets
    WHERE network='tron' AND token='USDT' AND sweep_enabled=true
  `);

  for (const w of rows) {
    let bal = await getUsdtBalance(w.address);
    if (bal <= 0) continue;

    let priv;
    try { priv = decrypt(w.priv_enc); }
    catch { continue; }

    try {
      await sendFromPrivateKey(priv, OMNIBUS_TRON_ADDRESS, bal);
      await pool.query(`UPDATE deposits SET swept=true WHERE to_addr=$1`, [w.address]);
    } catch (err) {
      console.error('sweep error:', err.message);
    }
  }
};
