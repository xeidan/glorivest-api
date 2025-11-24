// src/controllers/auth.controller.js
'use strict';

const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');

// ----------------------------
// JWT helper
// ----------------------------
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ----------------------------
// OTP Helpers
// ----------------------------
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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
     AND used = false
     AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase(), code, purpose]
  );
  return q.rows[0];
}

// ----------------------------
// REGISTER
// ----------------------------
exports.register = async (req, res) => {
  try {
    const { email, password, referral_code } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const check = await pool.query(
      'SELECT id FROM users WHERE email=$1 LIMIT 1',
      [email.toLowerCase()]
    );
    if (check.rows.length)
      return res.status(400).json({ message: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);

    let userRow;
    if (referral_code) {
      userRow = await pool.query(
        `INSERT INTO users(email, password_hash, bot_active, balance, referral_code)
         VALUES($1, $2, false, 0, $3)
         RETURNING id, email`,
        [email.toLowerCase(), hash, referral_code]
      );
    } else {
      userRow = await pool.query(
        `INSERT INTO users(email, password_hash, bot_active, balance)
         VALUES($1, $2, false, 0)
         RETURNING id, email`,
        [email.toLowerCase(), hash]
      );
    }

    // OPTIONAL referral credit
    if (referral_code) {
      try {
        const ref = await pool.query(
          'SELECT id FROM users WHERE referral_code=$1 LIMIT 1',
          [referral_code]
        );
        if (ref.rows.length) {
          await pool.query(
            'UPDATE users SET balance = balance + 100 WHERE id = $1',
            [ref.rows[0].id]
          );
        }
      } catch (e) {
        console.warn('Referral bonus failed:', e);
      }
    }

    // IMPORTANT: DO NOT send welcome email here
    // Welcome email will be sent ONLY after OTP verification

    return res.json({ message: 'Account created', user: userRow.rows[0] });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// LOGIN
// ----------------------------
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
      user: { id: user.id, email: user.email }
    });

  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// ME
// ----------------------------
exports.me = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, email, balance, default_account_id, referral_code
       FROM users WHERE id=$1 LIMIT 1`,
      [req.user.id]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'User not found' });

    return res.json(q.rows[0]);

  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// SEND OTP (verify or reset)
// ----------------------------
exports.sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'verify' } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    let user = null;

    // For password reset, user must exist
    if (purpose === 'reset') {
      const q = await pool.query(
        'SELECT id FROM users WHERE email=$1 LIMIT 1',
        [email.toLowerCase()]
      );
      if (!q.rows.length)
        return res.status(400).json({ message: 'No account with that email' });
      user = q.rows[0];
    } else {
      // For verification, user may or may not exist
      const q = await pool.query(
        'SELECT id FROM users WHERE email=$1 LIMIT 1',
        [email.toLowerCase()]
      );
      if (q.rows.length) user = q.rows[0];
    }

    const code = genOtp();

    const otpRow = await saveOtp({
      email,
      user_id: user ? user.id : null,
      purpose,
      code
    });

    // Email OTP
    try {
      const subject =
        purpose === 'verify'
          ? 'Your Glorivest verification code'
          : 'Your Glorivest password reset code';

      const html = EmailTpl?.otp
        ? EmailTpl.otp({ code, purpose, email })
        : `<p>Your OTP is <b>${code}</b></p>`;

      await sendMailSafe({ to: email, subject, html });

    } catch (e) {
      console.warn('OTP email failed:', e);
    }

    return res.json({ message: 'OTP sent', expires_at: otpRow.expires_at });
  } catch (err) {
    console.error('sendOtp error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// VERIFY OTP
// ----------------------------
exports.verifyOtp = async (req, res) => {
  try {
    const { email, code, purpose = 'verify' } = req.body;

    const otp = await findValidOtp(email, code, purpose);
    if (!otp) return res.status(400).json({ message: 'Invalid or expired code' });

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

      // SEND WELCOME EMAIL ONLY NOW
      try {
        await sendMailSafe({
          to: email,
          subject: 'Welcome to Glorivest',
          html: EmailTpl?.welcome
            ? EmailTpl.welcome({ email })
            : `<p>Welcome ${email}</p>`
        });
      } catch (e) {
        console.warn('Welcome email failed:', e);
      }

      return res.json({ message: 'OTP verified', token, user });
    }

    return res.json({ message: 'OTP verified' });

  } catch (err) {
    console.error('verifyOtp error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// RESET PASSWORD
// ----------------------------
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    const otp = await findValidOtp(email, code, 'reset');
    if (!otp) return res.status(400).json({ message: 'Invalid or expired code' });

    const q = await pool.query(
      'SELECT id FROM users WHERE email=$1 LIMIT 1',
      [email.toLowerCase()]
    );
    if (!q.rows.length)
      return res.status(400).json({ message: 'Account not found' });

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2',
      [hash, q.rows[0].id]
    );

    await markOtpUsed(otp.id);

    return res.json({ message: 'Password reset successful' });

  } catch (err) {
    console.error('reset error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
