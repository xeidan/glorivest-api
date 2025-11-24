// src/controllers/auth.controller.js
'use strict';

const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');
const crypto = require('crypto');

// Helper: generate JWT
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// --- OTP and password reset helpers ---

// Helper: generate 6-digit numeric OTP
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Save otp to DB
async function saveOtp({ email, user_id = null, purpose = 'verify', code, ttlMinutes = 10 }) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const q = await pool.query(
    `INSERT INTO otps(email, user_id, otp, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at`,
    [email.toLowerCase(), user_id, code, purpose, expiresAt]
  );
  return q.rows[0];
}


// Mark OTP used
async function markOtpUsed(id) {
  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [id]);
}

// Find valid OTP row
async function findValidOtp(email, code, purpose) {
  const q = await pool.query(
    `SELECT * FROM otps
     WHERE email = $1 AND otp = $2 AND purpose = $3 AND expires_at > NOW()
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
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );
    if (existing.rows.length)
      return res.status(400).json({ message: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);

    // Build dynamic insert so referral_code is optional.
    let result;
    if (referral_code) {
      // Try to find referrer (optional). We'll still store referral_code on user if present.
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

    // Optionally reward referrer: look up user by referral_code and credit
    if (referral_code) {
      try {
        const ref = await pool.query('SELECT id FROM users WHERE referral_code = $1 LIMIT 1', [referral_code]);
        if (ref.rows.length) {
          const referrerId = ref.rows[0].id;
          // Example: credit small bonus to referrer balance (change amount as needed)
          await pool.query('UPDATE users SET balance = balance + 100 WHERE id = $1', [referrerId]);
          // Optionally, log referral in referrals table if you have one
          // await pool.query('INSERT INTO referrals(referrer_id, referred_email) VALUES($1,$2)', [referrerId, email.toLowerCase()]);
        }
      } catch (e) {
        console.warn('Referral reward failed (continuing):', e);
      }
    }

    // Send welcome email (best-effort)
    try {
      await sendMailSafe({
        to: email,
        subject: 'Welcome to Glorivest',
        html: EmailTpl.welcome ? EmailTpl.welcome({ email }) : `<p>Welcome ${email}</p>`
      });
    } catch (e) {
      console.warn('Failed to send welcome email', e);
    }

    return res.json({ message: 'Account created', user: result.rows[0] });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// --------------------
// AUTH: login
// --------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

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

// --------------------
// AUTH: me
// --------------------
exports.me = async (req, res) => {
  try {
    // auth middleware should have attached req.user (id + email)
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    // Optionally fetch additional fields from DB (balance, default_account_id, referral_code)
    const q = await pool.query('SELECT id, email, balance, default_account_id, referral_code FROM users WHERE id=$1 LIMIT 1', [user.id]);
    if (!q.rows.length) return res.status(404).json({ message: 'User not found' });

    return res.json(q.rows[0]);
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// --------------------
// OTP / reset controllers (re-using the helpers you pasted)
// --------------------

// Controller: send OTP (generic — purpose: 'verify' or 'reset')
exports.sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'verify' } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });
    if (!['verify', 'reset'].includes(purpose)) return res.status(400).json({ message: 'Invalid purpose' });

    // check user exists for 'reset' and optionally for 'verify' we allow new users
    let user = null;
    if (purpose === 'reset') {
      const q = await pool.query('SELECT id, email FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (!q.rows.length) return res.status(400).json({ message: 'No account found for that email' });
      user = q.rows[0];
    } else {
      // for 'verify' try to get user id if exists (useful for linking)
      const q = await pool.query('SELECT id, email FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (q.rows.length) user = q.rows[0];
    }

    const code = genOtp();
    const otpRow = await saveOtp({ email, user_id: user ? user.id : null, purpose, code, ttlMinutes: 10 });

    // send email (using your existing helper)
    try {
      const subject = purpose === 'verify' ? 'Your Glorivest verification code' : 'Your Glorivest password reset code';
      const html = EmailTpl && EmailTpl.otp ? EmailTpl.otp({ code, purpose, email }) : `<p>Your code is ${code}</p>`;
      await sendMailSafe({ to: email, subject, html });
    } catch (e) {
      console.warn('Failed to send OTP email (continue);', e);
    }

    return res.json({ message: 'OTP sent', expires_at: otpRow.expires_at });
  } catch (err) {
    console.error('sendOtp error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// verify OTP — will sign token for purpose 'verify' (so user can be auto-logged-in),
// and only validate for purpose indicated.
exports.verifyOtp = async (req, res) => {
  try {
    const { email, code, purpose = 'verify' } = req.body;
    if (!email || !code) return res.status(400).json({ message: 'Missing email or code' });

    const otp = await findValidOtp(email, code, purpose);
    if (!otp) return res.status(400).json({ message: 'Invalid or expired code' });

    // mark used
    await markOtpUsed(otp.id);

    // For 'verify' we might want to return a token so UX flows to logged-in state:
    if (purpose === 'verify') {
      // ensure user exists — if not, return message (verify intended for registered users)
      const q = await pool.query('SELECT id, email FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (!q.rows.length) return res.status(400).json({ message: 'Account not found' });

      const user = q.rows[0];
      const token = signToken(user);
      return res.json({ message: 'OTP verified', token, user: { id: user.id, email: user.email } });
    }

    // For reset-only verification, just return success
    return res.json({ message: 'OTP verified' });
  } catch (err) {
    console.error('verifyOtp error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// resend OTP — thin wrapper around sendOtp (can rate-limit separately if needed)
exports.resendOtp = async (req, res) => {
  // reuse sendOtp logic
  return exports.sendOtp(req, res);
};

// reset password: expects { email, code, newPassword }
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ message: 'Missing fields' });

    const otp = await findValidOtp(email, code, 'reset');
    if (!otp) return res.status(400).json({ message: 'Invalid or expired code' });

    // find user
    const q = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (!q.rows.length) return res.status(400).json({ message: 'Account not found' });

    const user = q.rows[0];
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);

    // mark OTP used
    await markOtpUsed(otp.id);

    // optional: send confirmation email
    try {
      if (sendMailSafe && EmailTpl && EmailTpl.passwordResetConfirm) {
        await sendMailSafe({
          to: email,
          subject: 'Your password has been reset',
          html: EmailTpl.passwordResetConfirm({ email })
        });
      }
    } catch (e) { /* ignore send errors */ }

    return res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('resetPassword error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
