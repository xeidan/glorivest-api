// src/services/bot.service.js
'use strict';

const { pool } = require('../config/database');

// Start the bot for a user
exports.startBot = async (userId) => {
  const q = await pool.query(
    `SELECT balance, bot_active 
     FROM users 
     WHERE id=$1`,
    [userId]
  );

  if (!q.rows.length)
    throw new Error('User not found');

  const u = q.rows[0];

  if (u.bot_active)
    throw new Error('Bot already active');

  if (Number(u.balance) <= 0)
    throw new Error('Insufficient balance');

  await pool.query(
    `UPDATE users
     SET bot_active=true, bot_started_at=NOW(), eligible_for_withdrawal=false
     WHERE id=$1`,
    [userId]
  );

  return true;
};

exports.stopBot = async (userId) => {
  await pool.query(
    `UPDATE users
     SET bot_active=false,
         bot_started_at=NULL,
         bot_ended_at=NOW(),
         eligible_for_withdrawal=false
     WHERE id=$1`,
    [userId]
  );
};

exports.getBotStatus = async (userId) => {
  const q = await pool.query(
    `SELECT balance, bot_active, bot_started_at 
     FROM users 
     WHERE id=$1`,
    [userId]
  );
  return q.rows[0] || null;
};
