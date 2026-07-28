'use strict';

const db = require('../config/database');
const pool = db.pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendOTPEmail } = require('../services/email.service');
const { logDevice, getDevices } = require('../utils/device');
const { postTransaction } = require('../services/ledger.service');
const { generateReferralCode } = require('../utils/referralCode');





// -----------------------------
// Constants
// -----------------------------
const OTP_TTL_MIN = 10;
const DEMO_BALANCE_CENTS = 1_000_000;


function tierCodeFromSlug(slug) {
  const map = {
    standard: 'STD',
    pro: 'PRO',
    elite: 'ELT',
    demo: 'DEM'
  };

  return map[slug] || (slug || '').slice(0, 3).toUpperCase();
}

function genAccountCode(userId, seq, tierSlug) {
  const base = 150000 + Number(userId);
  const index = String(seq).padStart(2, '0');
  return `GV${base}-${index}-${tierCodeFromSlug(tierSlug)}`;
}

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
    const { email, password, referral_code: inputReferralCode } = req.body;

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

    // 1️⃣ Check if email already exists
    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (existing.length) {
      return error(res, 409, 'Email already registered');
    }

    // 2️⃣ Resolve referral code → BIGINT user id
    let referredBy = null;

    if (inputReferralCode) {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1`,
        [inputReferralCode.trim()]
      );

      if (rows.length) {
        referredBy = rows[0].id; // ✅ BIGINT
      }
    }

    // 3️⃣ Hash password
    const hash = await bcrypt.hash(password, 10);

    // 4️⃣ Generate OTP
const code = genOtp();

// 🔴 CRITICAL FOR LAUNCH (OTP fallback)
console.log('OTP GENERATED (REGISTER):', code, 'EMAIL:', normalizedEmail);

    // 5️⃣ Store OTP + registration payload
    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at, meta)
      VALUES ($1, $2, 'verify', NOW() + INTERVAL '${OTP_TTL_MIN} minutes', $3)
      `,
      [
        normalizedEmail,
        code,
        JSON.stringify({
          password_hash: hash,
          referred_by: referredBy ? Number(referredBy) : null
 // ✅ stored safely for verification step
        })
      ]
    );


await sendOTPEmail(normalizedEmail, code);

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

    const normalizedEmail = email.toLowerCase().trim();

    await client.query('BEGIN');

    // 1️⃣ Validate OTP
    const { rows: otpRows } = await client.query(
      `
      SELECT *
      FROM otps
      WHERE email = $1
        AND code = $2
        AND purpose = $3
        AND used = false
        AND expires_at > NOW()
      LIMIT 1
      `,
      [normalizedEmail, code, purpose]
    );

    if (!otpRows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const otp = otpRows[0];
    const meta = otp.meta || {};

    if (!meta.password_hash) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'OTP corrupted' });
    }

    // 2️⃣ Mark OTP as used
    await client.query(
      `UPDATE otps SET used = true WHERE id = $1`,
      [otp.id]
    );

    // 3️⃣ Create user
    const referralCode = generateReferralCode();

    const referredBy =
      meta.referred_by && Number.isInteger(Number(meta.referred_by))
        ? Number(meta.referred_by)
        : null;

    const { rows: userRows } = await client.query(
      `
      INSERT INTO users (
        email,
        password_hash,
        referral_code,
        referred_by
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, email
      `,
      [
        normalizedEmail,
        meta.password_hash,
        referralCode,
        referredBy
      ]
    );

    if (!userRows.length) {
      throw new Error('User creation failed');
    }

    const user = userRows[0];

    // 4️⃣ Create wallets INSIDE SAME TRANSACTION
  // Create default demo account
const tierRes = await client.query(
  `SELECT id, slug
   FROM account_tiers
   WHERE slug = 'demo'
   LIMIT 1`
);

if (tierRes.rowCount === 0) {
  throw new Error('Demo account tier not found');
}

const tier = tierRes.rows[0];

// Determine next account sequence for the user
const seqRes = await client.query(
  `SELECT COUNT(*)::int AS total
   FROM accounts
   WHERE user_id = $1`,
  [user.id]
);

const sequence = seqRes.rows[0].total + 1;

// These helper functions already exist in this file
const accountCode = genAccountCode(user.id, sequence, tier.slug);

const accountRes = await client.query(
  `INSERT INTO accounts (
      user_id,
      tier_id,
      account_code,
      status,
      balance_cents,
      profit_cents,
      created_at
   )
   VALUES ($1,$2,$3,'ACTIVE',$4,0,NOW())
   RETURNING id`,
  [
    user.id,
    tier.id,
    accountCode,
    DEMO_BALANCE_CENTS // Demo balance (10,000.00 if stored in cents)
  ]
);

await postTransaction(
  {
    userId: user.id,
    accountId: accountRes.rows[0].id,
    type: 'opening_balance',
    amountCents: DEMO_BALANCE_CENTS,
  },
  client
);

    await client.query('COMMIT');

    // 5️⃣ Issue JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
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
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password required'
      });
    }

    email = email.toLowerCase().trim();

    const { rows } = await pool.query(
      `
      SELECT id,
             email,
             password_hash,
             role,
             failed_login_attempts,
             account_locked_until
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];

    // 🔒 Check lock
    if (
      user.account_locked_until &&
      new Date(user.account_locked_until) > new Date()
    ) {
      return res.status(403).json({
        message: 'Account temporarily locked. Try again later.'
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      const attempts = user.failed_login_attempts + 1;

      if (attempts >= 5) {
        await pool.query(
          `
          UPDATE users
          SET failed_login_attempts = 0,
              account_locked_until = NOW() + INTERVAL '15 minutes'
          WHERE id = $1
          `,
          [user.id]
        );

        return res.status(403).json({
          message: 'Too many failed attempts. Account locked for 15 minutes.'
        });
      }

      await pool.query(
        `
        UPDATE users
        SET failed_login_attempts = $1
        WHERE id = $2
        `,
        [attempts, user.id]
      );

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // ✅ Reset attempts
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          account_locked_until = NULL
      WHERE id = $1
      `,
      [user.id]
    );

    const token = signToken(user);

    // ✅ CLEAN + COMPLETE RESPONSE
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'user', // 🔴 REQUIRED
        glorivest_id: `GV${150000 + Number(user.id)}`
      }
    });

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};





// -----------------------------
// ME (WALLET-BASED)
// -----------------------------
const me = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ Fetch user (NO referral joins, NO casts)
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

    // 2️⃣ Fetch wallets
    const { rows: wallets } = await pool.query(
      `
      SELECT id, code, type, balance_cents, status
      FROM wallets
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [userId]
    );

    const referralWallet =
      wallets.find(w => w.type === 'REFERRAL') || null;

    // 3️⃣ COUNT referrals CORRECTLY (BIGINT → BIGINT)
    const { rows: countRows } = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE referred_by = $1
      `,
      [userId] // ✅ THIS IS THE FIX
    );

    const totalReferrals = countRows[0]?.count || 0;

    // 4️⃣ Respond
    return res.json({
      id: user.id,
      email: user.email,
      glorivest_id: `GV${150000 + user.id}`,
      referral_code: user.referral_code,
      total_referrals: totalReferrals,
      referral_earnings_cents: referralWallet
        ? Number(referralWallet.balance_cents)
        : 0,
      referral_wallet: referralWallet,
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

    // 🔴 CRITICAL FOR LAUNCH
    console.log('OTP GENERATED (EMAIL UPDATE):', code, 'EMAIL:', newEmail.toLowerCase());

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at, meta)
      VALUES ($1, $2, 'email_update', NOW() + INTERVAL '${OTP_TTL_MIN} minutes', $3)
      `,
      [newEmail.toLowerCase(), code, JSON.stringify({ user_id: userId })]
    );

    await sendOTPEmail(newEmail, code);

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

// 🔴 CRITICAL FOR LAUNCH
console.log('OTP GENERATED (SEND OTP):', code, 'EMAIL:', email);

    await pool.query(
      `
      INSERT INTO otps (email, code, purpose, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_TTL_MIN} minutes')
      `,
      [email.toLowerCase(), code, purpose]
    );

    await sendOTPEmail(email, code);

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
