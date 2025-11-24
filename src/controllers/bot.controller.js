// src/controllers/bot.controller.js
'use strict';

const { pool } = require('../config/database');

exports.startBot = async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await pool.query(
      'SELECT balance, bot_active FROM users WHERE id=$1',
      [userId]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'User not found' });

    const u = q.rows[0];

    if (u.bot_active)
      return res.status(400).json({ message: 'Bot already running' });

    if (u.balance <= 0)
      return res.status(400).json({ message: 'Insufficient balance' });

    await pool.query(
      `UPDATE users
       SET bot_active = true,
           bot_started_at = NOW(),
           eligible_for_withdrawal = false
       WHERE id = $1`,
      [userId]
    );

    return res.json({ message: 'Bot started' });
  } catch (err) {
    console.error('startBot error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.stopBot = async (req, res) => {
  try {
    const userId = req.user.id;

    await pool.query(
      `UPDATE users
       SET bot_active = false,
           bot_started_at = NULL,
           bot_ended_at = NOW(),
           eligible_for_withdrawal = false
       WHERE id = $1`,
      [userId]
    );

    return res.json({ message: 'Bot stopped' });
  } catch (err) {
    console.error('stopBot error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.status = async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT balance, bot_active, bot_started_at
       FROM users
       WHERE id=$1 LIMIT 1`,
      [userId]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'User not found' });

    return res.json(q.rows[0]);
  } catch (err) {
    console.error('bot status error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
