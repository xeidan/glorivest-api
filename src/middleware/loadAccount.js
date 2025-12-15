// src/middleware/loadAccount.js
'use strict';

const pool = require('../config/database').pool;
const { postTransaction } = require('../services/ledger.service');
const { DEMO_DEFAULT_CENTS } = require('../config/demo');

module.exports = async function loadAccount(req, res, next) {
  const client = await pool.connect();

  try {
    const accountId =
      Number(req.params.accountId) ||
      Number(req.body.accountId) ||
      Number(req.query.accountId);

    if (!accountId) {
      client.release();
      return res.status(400).json({ message: 'accountId is required' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT a.*, t.slug AS tier_slug
       FROM accounts a
       JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.id=$1 AND a.user_id=$2
       LIMIT 1`,
      [accountId, req.user.id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ message: 'Account not found' });
    }

    const account = rows[0];

    // 🔒 AUTO-CREDIT DEMO ON FIRST ACCESS (ONCE)
    if (account.tier_slug === 'demo' && account.balance_cents === 0) {
      await postTransaction(
        {
          userId: account.user_id,
          accountId: account.id,
          type: 'demo_opening_balance',
          amountCents: DEMO_DEFAULT_CENTS
        },
        client
      );

      // reflect new balance immediately
      account.balance_cents = DEMO_DEFAULT_CENTS;
    }

    await client.query('COMMIT');

    req.account = account;
    next();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('loadAccount error', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};
