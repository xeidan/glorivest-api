'use strict';

const { pool } = require('../config/database');

/**
 * START TRADE / BOT CYCLE
 */
const startTrade = async (req, res) => {
  const userId = req.user.id;
  const { amount_cents, wallet_type } = req.body;

  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  if (!['DEMO', 'REAL'].includes(wallet_type)) {
    return res.status(400).json({ message: 'Invalid wallet type' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock wallet
    const { rows } = await client.query(
      `
      SELECT id, balance_cents
      FROM wallets
      WHERE user_id=$1 AND type=$2
      FOR UPDATE
      `,
      [userId, wallet_type]
    );

    if (!rows.length) throw new Error('Wallet not found');

    const wallet = rows[0];

    if (Number(wallet.balance_cents) < amount_cents) {
      throw new Error('Insufficient balance');
    }

    // Deduct capital
    await client.query(
      `UPDATE wallets SET balance_cents = balance_cents - $1 WHERE id=$2`,
      [amount_cents, wallet.id]
    );

    // Create cycle
    const { rows: cycleRows } = await client.query(
      `
      INSERT INTO trading_cycles (user_id, wallet_type, capital_cents, status)
      VALUES ($1,$2,$3,'RUNNING')
      RETURNING *
      `,
      [userId, wallet_type, amount_cents]
    );

    await client.query('COMMIT');

    res.json({ cycle: cycleRows[0] });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

/**
 * COMPLETE TRADE / BOT CYCLE
 * (used by worker OR manual claim)
 */
const completeCycle = async (req, res) => {
  const userId = req.user.id;
  const { cycle_id, profit_cents } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT *
      FROM trading_cycles
      WHERE id=$1 AND user_id=$2 AND status='RUNNING'
      FOR UPDATE
      `,
      [cycle_id, userId]
    );

    if (!rows.length) throw new Error('Active cycle not found');

    const cycle = rows[0];

    // Credit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE user_id=$2 AND type=$3
      `,
      [
        cycle.capital_cents + (profit_cents || 0),
        userId,
        cycle.wallet_type
      ]
    );

    // Close cycle
    await client.query(
      `
      UPDATE trading_cycles
      SET status='COMPLETED',
          profit_cents=$1,
          completed_at=now()
      WHERE id=$2
      `,
      [profit_cents || 0, cycle.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Cycle completed' });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

module.exports = {
  startTrade,
  completeCycle
};
