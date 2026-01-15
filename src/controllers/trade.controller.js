'use strict';

const { pool } = require('../config/database');

/**
 * Execute a trade
 * DEMO and REAL wallets only
 */
const placeTrade = async (req, res) => {
  const userId = req.user.id;
  const { wallet_id, amount_cents, asset, side } = req.body;

  if (!wallet_id || !amount_cents || amount_cents <= 0 || !asset || !side) {
    return res.status(400).json({ message: 'Invalid trade payload' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch wallet
    const { rows } = await client.query(
      `
      SELECT id, type, balance_cents, status
      FROM wallets
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [wallet_id, userId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Wallet not found' });
    }

    const wallet = rows[0];

    // 2. Enforce wallet rules
    if (wallet.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Wallet inactive' });
    }

    if (wallet.type === 'REFERRAL') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        message: 'Referral wallet cannot be used for trading'
      });
    }

    // 3. Balance check (both DEMO and REAL)
    if (Number(wallet.balance_cents) < amount_cents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // 4. Deduct balance
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [amount_cents, wallet.id]
    );

    // 5. Record trade
    await client.query(
      `
      INSERT INTO trades (
        user_id,
        wallet_id,
        wallet_type,
        asset,
        side,
        amount_cents,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'open')
      `,
      [
        userId,
        wallet.id,
        wallet.type,
        asset,
        side,
        amount_cents
      ]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Trade placed',
      wallet_type: wallet.type,
      amount_cents
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('placeTrade error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

module.exports = {
  placeTrade
};
