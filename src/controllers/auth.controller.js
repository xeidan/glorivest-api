'use strict';

const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');
const { logDevice, getDevices } = require('../utils/device');

// -----------------------------
// Constants
// -----------------------------
const OTP_TTL_MIN = 10;
const DEMO_BALANCE_CENTS = 1_000_000;

// -----------------------------
// Helpers
// -----------------------------
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function error(res, status = 400, message = 'Bad request') {
  return res.status(status).json({ message });
}

const STRONG_PASSWORD_REGEX =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

function validatePassword(password) {
  return STRONG_PASSWORD_REGEX.test(password);
}

// -----------------------------
// REGISTER (OTP ONLY, NO USER)
// -----------------------------
const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return error(res, 400, 'Email and password are required');
    }

    if (!validatePassword(password)) {
      return error(
        res,
        400,
        'Password must be at least 8 characters and include a letter, number, and symbol'
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, 10);
    const code = genOtp();

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at, meta)
      VALUES ($1, $2, 'verify', NOW() + INTERVAL '${OTP_TTL_MIN} minutes', $3)
      `,
      [normalizedEmail, code, JSON.stringify({ password_hash: hash })]
    );

    await sendMailSafe({
      to: normalizedEmail,
      subject: 'Your Glorivest verification code',
      html: EmailTpl?.otp
        ? EmailTpl.otp({ code, purpose: 'verify', email: normalizedEmail })
        : `<p>Your OTP is <b>${code}</b></p>`
    });

    return res.json({ message: 'OTP sent' });
  } catch (err) {
    console.error('register error', err);
    return error(res, 500, 'Server error');
  }
};


// -----------------------------
// SEND OTP
// -----------------------------
const sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'reset' } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // check user exists
    const userQ = await pool.query(
      `SELECT id FROM users WHERE email=$1 LIMIT 1`,
      [normalizedEmail]
    );

    if (!userQ.rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const code = genOtp();

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_TTL_MIN} minutes')
      `,
      [normalizedEmail, code, purpose]
    );

    await sendMailSafe({
      to: normalizedEmail,
      subject: 'Your Glorivest OTP',
      html: `<p>Your OTP is <b>${code}</b>. It expires in ${OTP_TTL_MIN} minutes.</p>`
    });

    return res.json({ message: 'OTP sent' });
  } catch (err) {
    console.error('sendOtp error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


// -----------------------------
// VERIFY OTP (CREATE USER + WALLETS)
// -----------------------------
const verifyOtp = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code, purpose = 'verify' } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code required' });
    }

    await client.query('BEGIN');

    // 1. Validate OTP
    const otpQ = await client.query(
      `
      SELECT * FROM otps
      WHERE email=$1
        AND code=$2
        AND purpose=$3
        AND used=false
        AND expires_at > now()
      LIMIT 1
      `,
      [email.toLowerCase(), code, purpose]
    );

    if (!otpQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const otp = otpQ.rows[0];

    // 2. Mark OTP used
    await client.query(`UPDATE otps SET used=true WHERE id=$1`, [otp.id]);

    // 3. Fetch user (must already exist from /register)
    const userQ = await client.query(
      `SELECT id, email FROM users WHERE email=$1 LIMIT 1`,
      [email.toLowerCase()]
    );

    if (!userQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'User not found' });
    }

    const user = userQ.rows[0];

    // 4. Check if wallets already exist
    const walletsQ = await client.query(
      `SELECT 1 FROM wallets WHERE user_id=$1 LIMIT 1`,
      [user.id]
    );

    if (!walletsQ.rows.length) {
      // REAL wallet
      const real = await client.query(
        `
        INSERT INTO wallets (user_id, code, type)
        VALUES ($1, $2, 'REAL')
        RETURNING id
        `,
        [user.id, `GV${user.id}-REAL`]
      );

      // DEMO wallet
      const demo = await client.query(
        `
        INSERT INTO wallets (user_id, code, type, balance_cents)
        VALUES ($1, $2, 'DEMO', 1000000)
        RETURNING id
        `,
        [user.id, `GV${user.id}-DEMO`]
      );

      // DEMO opening ledger
      await client.query(
        `
        INSERT INTO ledger (
          user_id,
          wallet_id,
          type,
          amount_cents,
          balance_after_cents
        )
        VALUES ($1, $2, 'demo_opening', 1000000, 1000000)
        `,
        [user.id, demo.rows[0].id]
      );

      // REFERRAL wallet
      await client.query(
        `
        INSERT INTO wallets (user_id, code, type)
        VALUES ($1, $2, 'REFERRAL')
        `,
        [user.id, `GV${user.id}-REF`]
      );
    }

    await client.query('COMMIT');

    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'OTP verified',
      token,
      user
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('verifyOtp error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};


// -----------------------------
// RESET PASSWORD WHEN OTP VERIFIED
// -----------------------------
const resetPassword = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code and new password are required' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters and include a letter, number, and symbol'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    await client.query('BEGIN');

    // validate OTP
    const otpQ = await client.query(
      `
      SELECT id FROM otps
      WHERE email=$1
        AND code=$2
        AND purpose='reset'
        AND used=false
        AND expires_at > now()
      LIMIT 1
      `,
      [normalizedEmail, code]
    );

    if (!otpQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // mark OTP used
    await client.query(
      `UPDATE otps SET used=true WHERE id=$1`,
      [otpQ.rows[0].id]
    );

    const hash = await bcrypt.hash(newPassword, 10);

    await client.query(
      `UPDATE users SET password_hash=$1 WHERE email=$2`,
      [hash, normalizedEmail]
    );

    await client.query('COMMIT');

    return res.json({ message: 'Password reset successful' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};



// -----------------------------
// LOGIN
// -----------------------------
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return error(res, 400, 'Email and password required');
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE email=$1 LIMIT 1`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return error(res, 400, 'Invalid credentials');
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return error(res, 400, 'Invalid credentials');
    }

    // device logging
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    try {
      await logDevice(user.id, userAgent, ip);
    } catch (_) {}

    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        glorivest_id: `GV${150000 + user.id}`
      }
    });
  } catch (err) {
    console.error('login error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// ME (WALLET-BASED)
// -----------------------------
const me = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows: userRows } = await pool.query(
      `
      SELECT id, email
      FROM users
      WHERE id=$1
      LIMIT 1
      `,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRows[0];

    const { rows: wallets } = await pool.query(
      `
      SELECT id, code, type, balance_cents, status
      FROM wallets
      WHERE user_id=$1
      ORDER BY created_at ASC
      `,
      [userId]
    );

    return res.json({
      id: user.id,
      email: user.email,
      glorivest_id: `GV${150000 + user.id}`,
      wallets
    });
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


// -----------------------------
// DEVICE HISTORY
// -----------------------------

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password required' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters and include a letter, number, and symbol'
      });
    }

    const userQ = await pool.query(
      `SELECT password_hash FROM users WHERE id=$1`,
      [userId]
    );

    if (!userQ.rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const match = await bcrypt.compare(currentPassword, userQ.rows[0].password_hash);
    if (!match) {
      return res.status(400).json({ message: 'Invalid current password' });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users SET password_hash=$1 WHERE id=$2`,
      [hash, userId]
    );

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    await pool.query(
      `DELETE FROM users WHERE id=$1`,
      [userId]
    );

    return res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('deleteAccount error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const requestEmailUpdate = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.id;

    if (!newEmail) {
      return res.status(400).json({ message: 'New email required' });
    }

    const code = genOtp();

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at, meta)
      VALUES ($1, $2, 'email_update', NOW() + INTERVAL '${OTP_TTL_MIN} minutes', $3)
      `,
      [newEmail.toLowerCase(), code, JSON.stringify({ user_id: userId })]
    );

    await sendMailSafe({
      to: newEmail,
      subject: 'Confirm your new email',
      html: `<p>Your OTP is <b>${code}</b>. It expires in ${OTP_TTL_MIN} minutes.</p>`
    });

    return res.json({ message: 'Verification code sent to new email' });
  } catch (err) {
    console.error('requestEmailUpdate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const confirmEmailUpdate = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code } = req.body;
    const userId = req.user.id;

    await client.query('BEGIN');

    const otpQ = await client.query(
      `
      SELECT id FROM otps
      WHERE email=$1
        AND code=$2
        AND purpose='email_update'
        AND used=false
        AND expires_at > now()
      LIMIT 1
      `,
      [email.toLowerCase(), code]
    );

    if (!otpQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    await client.query(
      `UPDATE otps SET used=true WHERE id=$1`,
      [otpQ.rows[0].id]
    );

    await client.query(
      `UPDATE users SET email=$1 WHERE id=$2`,
      [email.toLowerCase(), userId]
    );

    await client.query('COMMIT');

    return res.json({ message: 'Email updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('confirmEmailUpdate error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};


// -----------------------------
// DEVICE HISTORY
// -----------------------------
const getDeviceHistory = async (req, res) => {
  try {
    const devices = await getDevices(req.user.id);
    return res.json({ devices });
  } catch (err) {
    console.error('getDeviceHistory error', err);
    return error(res, 500, 'Server error');
  }
};


module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  me,
  resetPassword,
  changePassword,
  deleteAccount,
  requestEmailUpdate,
  confirmEmailUpdate,
  getDeviceHistory
};
