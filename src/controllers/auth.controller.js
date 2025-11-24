// src/controllers/auth.controller.js
'use strict';

const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');

// Helper: generate JWT
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

exports.register = async (req, res) => {
  try {
    const { email, password } = req.body;

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );
    if (existing.rows.length)
      return res.status(400).json({ message: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users(email, password_hash, bot_active, balance)
       VALUES($1, $2, false, 0) RETURNING id, email`,
      [email.toLowerCase(), hash]
    );

    sendMailSafe({
      to: email,
      subject: 'Welcome to Glorivest',
      html: EmailTpl.welcome({ email }),
    });

    return res.json({ message: 'Account created', user: result.rows[0] });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const q = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email=$1 LIMIT 1',
      [email.toLowerCase()]
    );

    if (!q.rows.length)
      return res.status(400).json({ message: 'Invalid credentials' });

    const user = q.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(400).json({ message: 'Invalid credentials' });

    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Simple profile endpoint (requires auth middleware)
exports.me = async (req, res) => {
  const user = req.user;
  return res.json(user);
};
