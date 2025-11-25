// src/controllers/auth.controller.js
'use strict';


const pool = require('../config/database').pool;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { sendMailSafe, EmailTpl } = require('../utils/email');
const { logDevice, getDevices } = require('../utils/device');

const { genAccountCode, tierSlugToCode } = require('../utils/accounts');
const STRONG_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const OTP_DEFAULT_TTL_MIN = 10;

// -----------------------------
// Utility helpers
// -----------------------------
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function saveOtp({ email, user_id = null, purpose, code, ttlMinutes = OTP_DEFAULT_TTL_MIN }) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();
  const q = await pool.query(
    `INSERT INTO otps(email, user_id, code, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, expires_at`,
    [email.toLowerCase(), user_id, code, purpose, expiresAt]
  );
  return q.rows[0];
}

async function markOtpUsed(id) {
  await pool.query(`UPDATE otps SET used = true WHERE id=$1`, [id]);
}

async function findValidOtp(email, code, purpose) {
  const q = await pool.query(
    `SELECT *
     FROM otps
     WHERE email=$1
       AND code=$2
       AND purpose=$3
       AND used=false
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase(), code, purpose]
  );
  return q.rows[0];
}

function validatePassword(password) {
  return STRONG_PASSWORD_REGEX.test(password);
}

function error(res, status = 400, message = 'Bad request') {
  return res.status(status).json({ message });
}

// -----------------------------
// REGISTER
// -----------------------------
exports.register = async (req, res) => {
  try {
    const { email, password, referral_code } = req.body;
    if (!email || !password) return error(res, 400, 'Email and password are required');

    if (!validatePassword(password)) {
      return error(res, 400, 'Password must be at least 8 characters long and include a letter, a number, and a symbol.');
    }

    const exists = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (exists.rows.length) return error(res, 400, 'Email already exists');

    const hash = await bcrypt.hash(password, 10);

    const q = referral_code
      ? await pool.query(
          `INSERT INTO users(email, password_hash, bot_active, balance, referral_code)
           VALUES($1, $2, false, 0, $3) RETURNING id, email`,
          [email.toLowerCase(), hash, referral_code]
        )
      : await pool.query(
          `INSERT INTO users(email, password_hash, bot_active, balance)
           VALUES($1, $2, false, 0) RETURNING id, email`,
          [email.toLowerCase(), hash]
        );

    return res.json({ message: 'Account created', user: q.rows[0] });
  } catch (err) {
    console.error('register error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// LOGIN
// -----------------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return error(res, 400, 'Email and password are required');

    const q = await pool.query('SELECT id, email, password_hash FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (!q.rows.length) return error(res, 400, 'Invalid credentials');

    const user = q.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      // Optionally log failed attempt here
      return error(res, 400, 'Invalid credentials');
    }

    // Device logging + basic suspicious detection
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection.remoteAddress || 'unknown';

    try {
      await logDevice(user.id, userAgent, ip);
    } catch (e) {
      console.warn('logDevice failed', e);
    }

    let suspicious = false;
    try {
      const devices = await getDevices(user.id); // most recent first
      if (devices && devices.length > 1) {
        const previous = devices[1]; // second-most recent is previous
        if (previous.ip_address !== ip || previous.user_agent !== userAgent) {
          suspicious = true;
        }
      }
    } catch (e) {
      console.warn('getDevices failed', e);
    }

    // Send email alert (best-effort)
    try {
      await sendMailSafe({
        to: user.email,
        subject: suspicious ? 'Suspicious Login Detected on Your Glorivest Account' : 'New Login to Your Glorivest Account',
        html: EmailTpl?.loginAlert
          ? EmailTpl.loginAlert({ ip, user_agent: userAgent, time: new Date().toISOString() })
          : `<p>New login detected:</p><p><b>IP:</b> ${ip}</p><p><b>Device:</b> ${userAgent}</p>`
      });
    } catch (e) {
      console.warn('sendMailSafe(login alert) failed', e);
    }

    const token = signToken(user);
    return res.json({ token, user: { id: user.id, email: user.email }, suspicious });
  } catch (err) {
    console.error('login error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// ME
// -----------------------------
exports.me = async (req, res) => {
  try {
    const userId = req.user.id;

    // Load user fields
    const { rows: users } = await pool.query(
      `SELECT id, email, balance, reward_balance, referral_code, total_referrals, referral_earnings
       FROM users
       WHERE id=$1
       LIMIT 1`,
      [userId]
    );
    if (!users.length) return error(res, 404, 'User not found');
    const user = users[0];

    // Load default (first) account with tier info
    const { rows: accts } = await pool.query(
      `SELECT a.id, a.account_code, a.balance_cents, t.slug AS tier_slug, t.name AS tier_name
       FROM accounts a
       LEFT JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.user_id=$1
       ORDER BY a.created_at ASC
       LIMIT 1`,
      [userId]
    );

    const first = accts[0] || null;

    return res.json({
      id: user.id,
      email: user.email,
      balance: Number(user.balance || 0),
      reward_balance: Number(user.reward_balance || 0),
      referral_code: user.referral_code,
      total_referrals: user.total_referrals || 0,
      referral_earnings: Number(user.referral_earnings || 0),

      // computed glorivest ID → GV150000 + userID
      glorivest_id: `GV${150000 + user.id}`,

      // account fields
      default_account_id: first ? first.id : null,
      default_account_code: first ? first.account_code : null,
      default_account_tier: first ? { slug: first.tier_slug, name: first.tier_name } : null
    });
  } catch (err) {
    console.error('me error', err);
    return error(res, 500, 'Server error');
  }
};



// -----------------------------
// SEND OTP
// -----------------------------
exports.sendOtp = async (req, res) => {
  try {
    const { email, purpose = 'verify' } = req.body;
    if (!email) return error(res, 400, 'Email required');

    let user = null;
    if (purpose === 'reset') {
      const q = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (!q.rows.length) return error(res, 400, 'No account with that email');
      user = q.rows[0];
    } else {
      const q = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
      if (q.rows.length) user = q.rows[0];
    }

    const code = genOtp();
    const otpRow = await saveOtp({ email, user_id: user ? user.id : null, purpose, code });

    try {
      const subject = purpose === 'verify' ? 'Your Glorivest verification code' : 'Your Glorivest password reset code';
      const html = EmailTpl?.otp ? EmailTpl.otp({ code, purpose, email }) : `<p>Your OTP is <b>${code}</b></p>`;
      await sendMailSafe({ to: email, subject, html });
    } catch (e) {
      console.warn('OTP email failed:', e);
    }

    return res.json({ message: 'OTP sent', expires_at: otpRow.expires_at });
  } catch (err) {
    console.error('sendOtp error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// VERIFY OTP
// -----------------------------
exports.verifyOtp = async (req, res) => {
  try {
    const { email, code, purpose = 'verify' } = req.body;
    if (!email || !code) return error(res, 400, 'Email and code required');

    const otp = await findValidOtp(email, code, purpose);
    if (!otp) return error(res, 400, 'Invalid or expired code');

    // consume otp for verify
    if (purpose === 'verify') await markOtpUsed(otp.id);

    if (purpose === 'verify') {
      // get user
      const q = await pool.query(
        'SELECT id, email FROM users WHERE email=$1 LIMIT 1',
        [email.toLowerCase()]
      );
      if (!q.rows.length) return error(res, 400, 'Account not found');
      const user = q.rows[0];

      const token = signToken(user);

      // AUTO-CREATE FIRST STANDARD ACCOUNT IF NONE EXISTS
      try {
        const check = await pool.query(
          'SELECT COUNT(*)::int AS c FROM accounts WHERE user_id=$1',
          [user.id]
        );

        if (Number(check.rows[0].c) === 0) {
          const acctCode = genAccountCode(user.id, 1, 'standard');

          await pool.query(
            `INSERT INTO accounts (user_id, tier_id, account_code, status, balance_cents, profit_cents, created_at)
             VALUES (
               $1,
               (SELECT id FROM account_tiers WHERE slug='standard' LIMIT 1),
               $2, 'active', 0, 0, NOW())`,
            [user.id, acctCode]
          );
        }
      } catch (e) {
        console.error('Auto-create default account failed', e);
      }

      // welcome email (best effort)
      try {
        await sendMailSafe({
          to: email,
          subject: 'Welcome to Glorivest',
          html: EmailTpl?.welcome ? EmailTpl.welcome({ email }) : `<p>Welcome ${email}</p>`
        });
      } catch (e) {}

      return res.json({ message: 'OTP verified', token, user });
    }

    // reset password or update email flow
    return res.json({ message: 'OTP verified' });

  } catch (err) {
    console.error('verifyOtp error', err);
    return error(res, 500, 'Server error');
  }
};




// -----------------------------
// CREATE ACCOUNT
// -----------------------------

exports.createAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const tier_slug = (req.body.tier_slug || req.body.tier_code || req.body.tier || '').toString().toLowerCase();
    if (!['standard','pro','elite'].includes(tier_slug)) {
      return res.status(400).json({ message: 'Invalid tier' });
    }

    // ensure tier exists and get its id
    const { rows: tierRows } = await pool.query(
      `SELECT id FROM account_tiers WHERE slug=$1 LIMIT 1`,
      [tier_slug]
    );
    if (!tierRows.length) return res.status(400).json({ message: 'Invalid tier' });
    const tierId = tierRows[0].id;

    // compute next sequence (count existing accounts)
    const { rows: [{ c }] } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM accounts WHERE user_id=$1`,
      [userId]
    );
    const nextSeq = Number(c) + 1; // if user already had 1 (default) => nextSeq = 2

    const account_code = genAccountCode(userId, nextSeq, tier_slug);

    const { rows: [acc] } = await pool.query(
      `INSERT INTO accounts (user_id, tier_id, account_code, status, balance_cents, profit_cents, created_at)
       VALUES ($1, $2, $3, 'active', 0, 0, NOW())
       RETURNING id, user_id, tier_id, account_code, status, balance_cents, profit_cents, created_at`,
      [userId, tierId, account_code]
    );

    // return a small enriched payload for frontend convenience
    return res.status(201).json({
      id: acc.id,
      account_code: acc.account_code,
      status: acc.status,
      balance_cents: acc.balance_cents,
      profit_cents: acc.profit_cents,
      created_at: acc.created_at,
      tier: tier_slug,
      tier_code: tierSlugToCode(tier_slug)
    });
  } catch (err) {
    console.error('createAccount error', err);
    if (String(err.code) === '23505') {
      return res.status(409).json({ message: 'Account code conflict, retry' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};



// -----------------------------
// RESET PASSWORD (OTP-based)
// -----------------------------
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return error(res, 400, 'Email, code and new password are required');

    if (!validatePassword(newPassword)) {
      return error(res, 400, 'Password must be at least 8 characters long and include a letter, a number, and a symbol.');
    }

    const otp = await findValidOtp(email, code, 'reset');
    if (!otp) return error(res, 400, 'Invalid or expired code');

    const q = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (!q.rows.length) return error(res, 400, 'Account not found');

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, q.rows[0].id]);

    await markOtpUsed(otp.id); // consume OTP after successful reset
    return res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('resetPassword error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// CHANGE PASSWORD (Authenticated)
// -----------------------------
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return error(res, 400, 'Both current and new passwords are required');

    if (!validatePassword(newPassword)) {
      return error(res, 400, 'New password must be at least 8 characters long and include a letter, a number, and a symbol.');
    }

    const q = await pool.query('SELECT id, password_hash FROM users WHERE id=$1 LIMIT 1', [req.user.id]);
    if (!q.rows.length) return error(res, 404, 'User not found');

    const user = q.rows[0];
    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) return error(res, 400, 'Incorrect current password');

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('changePassword error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// DELETE ACCOUNT (Soft delete)
// -----------------------------
exports.deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return error(res, 400, 'Password required');

    const q = await pool.query('SELECT id, password_hash FROM users WHERE id=$1 LIMIT 1', [req.user.id]);
    if (!q.rows.length) return error(res, 404, 'User not found');

    const user = q.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return error(res, 400, 'Incorrect password');

    // Soft-delete column must exist (see migrations). If you want hard delete, replace with DELETE.
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id=$1', [user.id]);

    return res.json({ message: 'Account deleted (soft)' });
  } catch (err) {
    console.error('deleteAccount error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// EMAIL UPDATE (request + confirm)
// -----------------------------
exports.requestEmailUpdate = async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail) return error(res, 400, 'New email required');

    // Ensure email not in use
    const exists = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [newEmail.toLowerCase()]);
    if (exists.rows.length) return error(res, 400, 'Email already in use');

    const code = genOtp();
    await saveOtp({ email: newEmail, user_id: req.user.id, purpose: 'update-email', code, ttlMinutes: 15 });

    try {
      await sendMailSafe({
        to: newEmail,
        subject: 'Verify New Email Address',
        html: EmailTpl?.otp ? EmailTpl.otp({ code, purpose: 'update-email', email: newEmail }) : `<p>Your verification code is <b>${code}</b></p>`
      });
    } catch (e) {
      console.warn('requestEmailUpdate: sendMailSafe failed', e);
    }

    return res.json({ message: 'Verification code sent to new email' });
  } catch (err) {
    console.error('requestEmailUpdate error', err);
    return error(res, 500, 'Server error');
  }
};

exports.confirmEmailUpdate = async (req, res) => {
  try {
    const { newEmail, code } = req.body;
    if (!newEmail || !code) return error(res, 400, 'Email and code required');

    const otp = await findValidOtp(newEmail, code, 'update-email');
    if (!otp) return error(res, 400, 'Invalid or expired code');

    // Ensure OTP belongs to the requesting user
    if (otp.user_id !== req.user.id) return error(res, 403, 'OTP not valid for this user');

    await pool.query('UPDATE users SET email=$1 WHERE id=$2', [newEmail.toLowerCase(), req.user.id]);
    await markOtpUsed(otp.id);

    // Notify old email (best-effort)
    try {
      await sendMailSafe({
        to: req.user.email,
        subject: 'Your Glorivest email was changed',
        html: EmailTpl?.emailChanged ? EmailTpl.emailChanged({ oldEmail: req.user.email, newEmail }) : `<p>Your account email was changed to ${newEmail}</p>`
      });
    } catch (e) {
      console.warn('confirmEmailUpdate: notify old email failed', e);
    }

    return res.json({ message: 'Email updated successfully' });
  } catch (err) {
    console.error('confirmEmailUpdate error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// DEVICE HISTORY
// -----------------------------
exports.getDeviceHistory = async (req, res) => {
  try {
    const devices = await getDevices(req.user.id);
    return res.json({ devices });
  } catch (err) {
    console.error('getDeviceHistory error', err);
    return error(res, 500, 'Server error');
  }
};

// -----------------------------
// Exports
// -----------------------------
module.exports = {
  register: exports.register,
  login: exports.login,
  me: exports.me,
  sendOtp: exports.sendOtp,
  verifyOtp: exports.verifyOtp,
  resendOtp: exports.sendOtp,
  resetPassword: exports.resetPassword,
  changePassword: exports.changePassword,
  deleteAccount: exports.deleteAccount,
  requestEmailUpdate: exports.requestEmailUpdate,
  confirmEmailUpdate: exports.confirmEmailUpdate,
  getDeviceHistory: exports.getDeviceHistory
};
