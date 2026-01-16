// src/controllers/trade.controller.js
'use strict';

const { pool } = require('../config/database');

/**
 * Open a trade (DEMO or REAL only)
 */
const openTrade = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { wallet_id, symbol, amount_cents, side } = req.body;

    if (!wallet_id || !symbol || !amount_cents || !side) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    await client.query('BEGIN');

    // 1. Validate wallet
    const walletQ = await client.query(
      `
      SELECT id, type, balance_cents
      FROM wallets
      WHERE id=$1 AND user_id=$2 AND status='active'
      LIMIT 1
      `,
      [wallet_id, userId]
    );

    if (!walletQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid wallet' });
    }

    const wallet = walletQ.rows[0];

    if (!['DEMO', 'REAL'].includes(wallet.type)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Trading not allowed on this wallet' });
    }

    if (Number(wallet.balance_cents) < Number(amount_cents)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // 2. Debit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id=$2
      `,
      [amount_cents, wallet.id]
    );

    // 3. Create trade
    const tradeQ = await client.query(
      `
      INSERT INTO trades (user_id, wallet_id, symbol, side, amount_cents, status)
      VALUES ($1, $2, $3, $4, $5, 'OPEN')
      RETURNING *
      `,
      [userId, wallet.id, symbol, side, amount_cents]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Trade opened',
      trade: tradeQ.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('openTrade error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

/**
 * Close trade (credit back to same wallet)
 */
const closeTrade = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { trade_id, pnl_cents } = req.body;

    await client.query('BEGIN');

    const tradeQ = await client.query(
      `
      SELECT *
      FROM trades
      WHERE id=$1 AND user_id=$2 AND status='OPEN'
      LIMIT 1
      `,
      [trade_id, userId]
    );

    if (!tradeQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Trade not found' });
    }

    const trade = tradeQ.rows[0];

    // 1. Close trade
    await client.query(
      `
      UPDATE trades
      SET status='CLOSED', pnl_cents=$1, closed_at=now()
      WHERE id=$2
      `,
      [pnl_cents, trade.id]
    );

    // 2. Credit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE id=$2
      `,
      [trade.amount_cents + pnl_cents, trade.wallet_id]
    );

    await client.query('COMMIT');

    return res.json({ message: 'Trade closed' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('closeTrade error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

module.exports = {
  openTrade,
  closeTrade
};
