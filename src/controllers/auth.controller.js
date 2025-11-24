// src/controllers/auth.controller.js
'use strict';

const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');

// ----------------------
// JWT helper
// ----------------------
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ----------------------
// OTP Helpers
// ----------------------
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Insert OTP
async function saveOtp({ email, user_id = null, purpose = 'verify', code, ttlMinutes = 10 }) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const q = await pool.query(
    `INSERT INTO otps(email, user_id, code, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, expires_at`,
    [email.toLowerCase(), user_id, code, purpose, expiresAt]
  );

  return q.rows[0];
}

async function markOtpUsed(id) {
  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [id]);
}

async function findValidOtp(email, code, purpose) {
  const q = await pool.query(
    `SELECT * FROM otps
     WHERE email = $1 
     AND code = $2 
     AND purpose = $3
     AND expires_at > NOW()
     AND used = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase(), code, purpose]
  );

  return q.rows[0];
}

// --------------------
// AUTH: register
// --------------------
exports.register = async (req, res) => {
  try {
    const { email, password, referral_code } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );
    if (existing.rows.length) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);

    let result;
    if (referral_code) {
      result = await pool.query(
        `INSERT INTO users(email, password_hash, bot_active, balance, referral_code)
         VALUES($1, $2, false, 0, $3) RETURNING id, email`,
        [email.toLowerCase(), hash, referral_code]
      );
    } else {
      result = await pool.query(
        `INSERT INTO users(email, password_hash, bot_active, balance)
         VALUES($1, $2, false, 0) RETURNING id, email`,
        [email.toLowerCase(), hash]
      );
    }

    // referral credit logic unchanged (optional)
    if (referral_code) {
      try {
        const ref = await pool.query(
          'SELECT id FROM users WHERE referral_code = $1 LIMIT 1',
          [referral_code]
        );
        if (ref.rows.length) {
          await pool.query('UPDATE users SET balance = balance + 100 WHERE id = $1', [ref.rows[0].id]);
        }
      } catch (e) {
        console.warn('Referral reward failed:', e);
      }
    }

    // NO WELCOME EMAIL HERE ANYMORE!!!

    return res.json({ message: 'Account created', user: result.rows[0] });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


// ----------------------
// LOGIN
// ----------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

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

    res.json({
      token,
      user: { id: user.id, email: user.email }
    });

  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------
// ME
// ----------------------
exports.me = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, email, balance, default_account_id, referral_code
       FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'User not found' });

    res.json(q.rows[0]);

  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------
// SEND OTP
// ----------------------
exports.sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'verify' } = req.body;

    let user = null;

    if (purpose === 'reset') {
      const q = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (!q.rows.length)
        return res.status(400).json({ message: 'No account for that email' });
      user = q.rows[0];
    } else {
      const q = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (q.rows.length) user = q.rows[0];
    }

    const code = genOtp();
    const otpRow = await saveOtp({ email, user_id: user ? user.id : null, purpose, code });

    try {
      const subject = purpose === 'verify'
        ? 'Your Glorivest verification code'
        : 'Your Glorivest password reset code';

      const html = EmailTpl?.otp
        ? EmailTpl.otp({ code, purpose, email })
        : `<p>Your OTP is ${code}</p>`;

      await sendMailSafe({ to: email, subject, html });
    } catch {}

    res.json({ message: 'OTP sent', expires_at: otpRow.expires_at });

  } catch (err) {
    console.error('sendOtp error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------
// VERIFY OTP (NOW SENDS WELCOME EMAIL)
// ----------------------
// verify OTP — will sign token, etc.
exports.verifyOtp = async (req, res) => {
  try {
    const { email, code, purpose = 'verify' } = req.body;
    if (!email || !code)
      return res.status(400).json({ message: 'Missing email or code' });

    const otp = await findValidOtp(email, code, purpose);
    if (!otp)
      return res.status(400).json({ message: 'Invalid or expired code' });

    await markOtpUsed(otp.id);

    if (purpose === 'verify') {
      const q = await pool.query(
        'SELECT id, email FROM users WHERE email=$1 LIMIT 1',
        [email.toLowerCase()]
      );
      if (!q.rows.length)
        return res.status(400).json({ message: 'Account not found' });

      const user = q.rows[0];
      const token = signToken(user);

      // >>> SEND WELCOME EMAIL HERE <<<
      try {
        await sendMailSafe({
          to: email,
          subject: 'Welcome to Glorivest',
          html: EmailTpl.welcome
            ? EmailTpl.welcome({ email })
            : `<p>Welcome ${email}</p>`
        });
      } catch (e) {
        console.warn('Failed to send welcome email after OTP verification', e);
      }

      return res.json({ message: 'OTP verified', token, user });
    }

    return res.json({ message: 'OTP verified' });

  } catch (err) {
    console.error('verifyOtp error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


// ----------------------
// RESEND OTP
// ----------------------
exports.resendOtp = (req, res) => exports.sendOtp(req, res);

// ----------------------
// RESET PASSWORD
// ----------------------
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    const otp = await findValidOtp(email, code, 'reset');
    if (!otp) return res.status(400).json({ message: 'Invalid or expired code' });

    const q = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!q.rows.length) return res.status(400).json({ message: 'Account not found' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, q.rows[0].id]);
    await markOtpUsed(otp.id);

    res.json({ message: 'Password reset successful' });

  } catch (err) {
    console.error('resetPassword error', err);
    res.status(500).json({ message: 'Server error' });
  }
};
