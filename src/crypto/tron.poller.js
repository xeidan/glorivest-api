// src/crypto/tron.poller.js
'use strict';

const { pool, withTx } = require('../config/database');
const fetch = require('node-fetch');
const { TRON_FULLHOST, USDT_TRON_CONTRACT } = require('../config/env');

// ===== Helpers =====
async function getCursor() {
  const r = await pool.query(`SELECT value FROM settings WHERE key='tron_since_ts'`);
  return r.rows[0] ? Number(r.rows[0].value) : 0;
}

async function setCursor(ts) {
  await pool.query(
    `INSERT INTO settings (key,value)
     VALUES ('tron_since_ts', $1)
     ON CONFLICT (key) DO UPDATE SET value=$1`,
    [ts]
  );
}

// ===== Credit Deposit =====
async function credit(userId, accountId, amount, tx) {
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO deposits (user_id, account_id, network, token, tx_hash, amount, status)
       VALUES ($1,$2,'tron','USDT',$3,$4,'confirmed')
       ON CONFLICT (tx_hash) DO NOTHING`,
      [userId, accountId, tx, amount]
    );

    await c.query(
      `UPDATE users SET balance = balance + $1 WHERE id=$2`,
      [amount, userId]
    );

    if (accountId) {
      const cents = Math.round(amount * 100);
      await c.query(
        `UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id=$2`,
        [cents, accountId]
      );
    }
  });
}

// ===== Main Poller =====
exports.pollTron = async () => {
  const since = await getCursor();
  let maxTs = since;

  const { rows: wallets } = await pool.query(`
    SELECT user_id, account_id, address
    FROM wallets
    WHERE network='tron' AND token='USDT'
  `);

  for (const w of wallets) {
    const u = new URL(`${TRON_FULLHOST}/v1/accounts/${w.address}/transactions/trc20`);
    u.searchParams.set('only_to', 'true');
    u.searchParams.set('limit', '200');
    u.searchParams.set('contract_address', USDT_TRON_CONTRACT);
    if (since) u.searchParams.set('min_timestamp', since);

    const resp = await fetch(u);
    if (!resp.ok) continue;

    const json = await resp.json();
    const txs = json.data || [];

    for (const t of txs) {
      if (t.to !== w.address) continue;

      const ts = Number(t.block_timestamp);
      if (ts > maxTs) maxTs = ts;

      const decimals = Number(t.token_info.decimals || 6);
      const amount = Number(t.value) / Math.pow(10, decimals);

      await credit(w.user_id, w.account_id, amount, t.transaction_id);
    }
  }

  await setCursor(maxTs + 1);
};
