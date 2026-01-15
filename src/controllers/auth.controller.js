'use strict';

const db = require('../config/database');
const pool = db.pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');
const { logDevice, getDevices } = require('../utils/device');
const { ensureUserWallets } = require('../services/wallet.service');
const { generateReferralCode } = require('../utils/referralCode');


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

function generateReferralCode(userId) {
  return `GVREF${100000 + userId}`;
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
// REFERRAL CODE ENSURE
// -----------------------------
const user = userQ.rows[0];

// Generate referral code ONLY if missing
if (!user.referral_code) {
  let referralCode;
  let exists = true;

  while (exists) {
    referralCode = generateReferralCode();
    const check = await client.query(
      `SELECT 1 FROM users WHERE referral_code = $1 LIMIT 1`,
      [referralCode]
    );
    exists = check.rows.length > 0;
  }

  await client.query(
    `UPDATE users SET referral_code = $1 WHERE id = $2`,
    [referralCode, user.id]
  );
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

    // Ensure referral code exists
    const referralCode = generateReferralCode(user.id);

    await client.query(
      `
      UPDATE users
      SET referral_code = COALESCE(referral_code, $1)
      WHERE id = $2
      `,
      [referralCode, user.id]
    );


    await ensureUserWallets(user.id);

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
// LOGIN
// -----------------------------
const login = async (req, res) => {
  try {
    // 🔍 HARD GUARD — this catches bad JSON early
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        message: 'Invalid request body'
      });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password required'
      });
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // -----------------------------
    // DEVICE LOGGING (SAFE)
    // -----------------------------
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    try {
      await logDevice(user.id, userAgent, ip);
    } catch (e) {
      console.warn('Device log failed:', e.message);
    }

    // Ensure user has wallets// Ensure wallets always exist
    await ensureUserWallets(user.id);

    const token = signToken({ id: user.id, email: user.email });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        glorivest_id: `GV${150000 + user.id}`
      }
    });

  } catch (err) {
    console.error('LOGIN ERROR FULL:', err);

    return res.status(500).json({
      message: 'Server error'
    });
  }
};




// -----------------------------
// ME (WALLET-BASED)
// -----------------------------
const me = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. User
    const { rows: userRows } = await pool.query(
      `
      SELECT id, email, referral_code
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRows[0];

    // 2. Wallets
    const { rows: wallets } = await pool.query(
      `
      SELECT id, code, type, balance_cents, status
      FROM wallets
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [userId]
    );

    // 3. Referral count
    const { rows: refCount } = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE referred_by = $1
      `,
      [userId]
    );

    // 4. Referral wallet
    const referralWallet = wallets.find(w => w.type === 'REFERRAL');

    return res.json({
      id: user.id,
      email: user.email,
      glorivest_id: `GV${150000 + user.id}`,

      referral_code: user.referral_code,
      total_referrals: refCount[0].count,
      referral_earnings: referralWallet
        ? Number(referralWallet.balance_cents) / 100
        : 0,

      wallets
    });

  } catch (err) {
    console.error('me error:', err);
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
// SEND OTP (GENERIC)
// -----------------------------
const sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'verify' } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email required' });
    }

    const code = genOtp();

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_TTL_MIN} minutes')
      `,
      [email.toLowerCase(), code, purpose]
    );

    await sendMailSafe({
      to: email,
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
// RESET PASSWORD
// -----------------------------
const resetPassword = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        message: 'Weak password'
      });
    }

    await client.query('BEGIN');

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
      [email.toLowerCase(), code]
    );

    if (!otpQ.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await client.query(
      `UPDATE users SET password_hash=$1 WHERE email=$2`,
      [hash, email.toLowerCase()]
    );

    await client.query(
      `UPDATE otps SET used=true WHERE id=$1`,
      [otpQ.rows[0].id]
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
  resetPassword,
  changePassword,
  deleteAccount,
  requestEmailUpdate,
  confirmEmailUpdate,
  getDeviceHistory,
  me
};
