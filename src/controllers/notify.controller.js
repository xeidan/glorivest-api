// src/controllers/notify.controller.js
'use strict';

const { sendEmail } = require('../services/email.service');
const { pool } = require('../config/database');

exports.notifyDeposit = async (req, res) => {
  try {
    const { user_id, amount_usd, tx_id } = req.body;

    const u = await pool.query(
      'SELECT email FROM users WHERE id=$1 LIMIT 1',
      [user_id]
    );

    if (!u.rows.length)
      return res.status(404).json({ message: 'User not found' });

    await sendEmail({
      to: u.rows[0].email,
      subject: 'Deposit Confirmed',
      html: EmailTpl.depositConfirmed({
        amount: amount_usd,
        tx: tx_id,
      }),
    });

    return res.json({ message: 'Email sent' });

  } catch (err) {
    console.error('notifyDeposit error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.notifyWithdrawal = async (req, res) => {
  try {
    const { user_id, amount_usd, tx_id } = req.body;

    const u = await pool.query(
      'SELECT email FROM users WHERE id=$1 LIMIT 1',
      [user_id]
    );

    if (!u.rows.length)
      return res.status(404).json({ message: 'User not found' });

    await sendEmail({
      to: u.rows[0].email,
      subject: 'Withdrawal Successful',
      html: EmailTpl.withdrawalConfirmed({
        amount: amount_usd,
        tx: tx_id,
      }),
    });

    return res.json({ message: 'Email sent' });

  } catch (err) {
    console.error('notifyWithdrawal error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.broadcastMessage = async (req, res) => {
  try {
    const { subject, message } = req.body;

    const users = await pool.query(`SELECT email FROM users`);

    for (const u of users.rows) {
      await sendMailSafe({
        to: u.email,
        subject,
        html: `<div>${message}</div>`,
      });
    }

    return res.json({ message: 'Broadcast sent to all users' });

  } catch (err) {
    console.error('broadcast error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
