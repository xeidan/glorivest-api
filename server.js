// glorivest-server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');

const app = express();
app.set('trust proxy', 1);

// ===== Setup SendGrid =====
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ===== PostgreSQL Connection =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===== CORS Config =====
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5502',
  'http://127.0.0.1:5502',
  'https://glorivest.com',
  'https://www.glorivest.com',
  'https://xeidan.github.io',
  'https://glorivest.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


app.options('*', cors());

// ===== Middleware =====
app.use(express.json());
app.use(morgan('dev'));

// ===== Test CORS =====
app.get('/test-cors', (req, res) => {
  res.json({ message: 'CORS is working' });
});

// ===== OTP RESEND Rate Limit =====
const otpResendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1,
  message: { message: 'Wait a minute before resending OTP.' }
});



//HELPERS
async function deleteOldUnverifiedUsers() {
  try {
    await pool.query(`
      DELETE FROM users
      WHERE is_verified = false
      AND otp_created_at IS NOT NULL
      AND otp_created_at < NOW() - INTERVAL '1 hour'
    `);
  } catch (err) {
    console.error('Error deleting unverified users:', err);
  }
}


// ===== AUTH MIDDLEWARE =====
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // 👈 IMPORTANT: attaches user data to the request
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}




// ===== ACCOUNT ME =====
app.get("/account/me", authenticate, async (req, res) => {
  console.log("🔐 /account/me hit", req.headers.authorization);
  try {
    const userId = req.user.id;
    console.log("User ID:", userId);

    const result = await pool.query(`
      SELECT email, id, balance, reward_balance, referral_code, total_referrals, referral_earnings
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];
    const glorivestId = `GV${150000 + user.id}`;

    res.json({
      email: user.email,
      glorivest_id: glorivestId,
      balance: parseFloat(user.balance || 0),
      reward_balance: parseFloat(user.reward_balance || 0),
      referral_code: user.referral_code || "N/A",
      total_referrals: user.total_referrals || 0,
      referral_earnings: parseFloat(user.referral_earnings || 0)
    });
  } catch (err) {
    console.error("Error in /account/me:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});



// ===== RESEND OTP =====
app.post('/resend-otp', otpResendLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  await deleteOldUnverifiedUsers();

  const client = await pool.connect();
  try {
    const userCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await client.query('BEGIN');

    await client.query(`
      UPDATE users 
      SET otp = $1, otp_created_at = NOW()
      WHERE email = $2
    `, [otp, email]);

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@earnrave.com',
      subject: 'Your Glorivest OTP Code',
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center;">
          <h2>🔐 Your Verification Code</h2>
          <p>Use the code below to complete your sign up:</p>
          <h1 style="font-size: 2rem; color: #00D2B1;">${otp}</h1>
          <p>This code is valid for 10 minutes. If you didn’t request this, ignore this email.</p>
        </div>
      `
    };

    await sgMail.send(msg);

    await client.query('COMMIT');
    res.status(200).json({ message: 'OTP resent successfully' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error resending OTP:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});


// ===== REFERRAL CODE HELPERS =====
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}


async function generateUniqueReferralCode() {
  let code;
  let exists = true;

  while (exists) {
    code = generateReferralCode();
    const result = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    exists = result.rows.length > 0;
  }

  return code;
}


// ===== SIGNUP =====
app.post('/signup', async (req, res) => {
  const { email, password, referred_by } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'All fields are required' });

  await deleteOldUnverifiedUsers();
  const client = await pool.connect();

  try {
    // Check if user already exists
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const referralCode = generateReferralCode();
    const referredBy = referred_by || null;

    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO users (
        email, password, otp, otp_created_at,
        is_verified, created_at,
        referral_code, referred_by
      )
      VALUES ($1, $2, $3, NOW(), false, NOW(), $4, $5)
      RETURNING id, email
    `, [email, hashedPassword, otp, referralCode, referredBy]);

    const newUser = result.rows[0];

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@glorivest.com',
      subject: 'Your Glorivest OTP Code',
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center;">
          <h2>🔐 Verify Your Email</h2>
          <p>Enter this code in the app to verify your email:</p>
          <h1 style="font-size: 2rem; color: #00D2B1;">${otp}</h1>
          <p>This code will expire in 10 minutes.</p>
        </div>
      `
    };

    await sgMail.send(msg);
    await client.query('COMMIT');

    res.status(201).json({ message: 'Signup successful. OTP sent.', token });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});





// ===== LOGIN =====
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'All fields are required' });

  await deleteOldUnverifiedUsers();

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ message: 'Incorrect password' });

    if (!user.is_verified) return res.status(403).json({ message: 'Please verify your account first' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d'
    });

    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});



// ===== VERIFY OTP =====
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

  await deleteOldUnverifiedUsers();

  try {
    const result = await pool.query('SELECT otp, otp_created_at FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const sentAt = new Date(user.otp_created_at);
    const diffInMin = (now - sentAt) / 1000 / 60;

    if (diffInMin > 10) return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
    if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

    await pool.query('UPDATE users SET otp = NULL, otp_created_at = NULL, is_verified = true WHERE email = $1', [email]);
    res.status(200).json({ message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});



// ===== RESET PASSWORD =====
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ message: 'Email and new password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1 WHERE email = $2',
      [hashedPassword, email]
    );

    res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ===== LEADERBOARD ROUTE =====
app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT email, referral_earnings, total_referrals, reward_balance
      FROM users
      ORDER BY reward_balance DESC
      LIMIT 10
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});


// ===== BOT START =====
app.post('/bot/start', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query('SELECT bot_active, bot_started_at, balance FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = result.rows[0];
    if (user.balance <= 0) return res.status(400).json({ message: 'Insufficient capital' });
    if (user.bot_active) return res.status(400).json({ message: 'Bot already running' });

    await pool.query(`
      UPDATE users
      SET bot_active = true,
          bot_started_at = NOW(),
          bot_ended_at = NULL,
          eligible_for_withdrawal = false
      WHERE id = $1
    `, [userId]);

    res.json({ message: 'Bot started successfully' });
  } catch (err) {
    console.error('Start bot error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});




// ===== BOT STOP =====
app.post('/bot/stop', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query('SELECT bot_active FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    await pool.query(`
      UPDATE users
      SET bot_active = false,
          bot_started_at = NULL,
          bot_ended_at = NOW(),
          eligible_for_withdrawal = false
    WHERE id = $1
    `, [userId]);

    res.json({ message: 'Bot stopped and reset.' });
  } catch (err) {
    console.error('Stop bot error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});




// ===== BOT STATUS =====
app.get('/bot/status', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(`
      SELECT balance, bot_active, bot_started_at
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const { balance, bot_active, bot_started_at } = result.rows[0];

    // Calculate days active
    let daysActive = 0;
    if (bot_started_at) {
      const started = new Date(bot_started_at);
      const now = new Date();
      const msInDay = 1000 * 60 * 60 * 24;
      daysActive = Math.floor((now - started) / msInDay);
    }

    res.json({
      balance: parseFloat(balance || 0),
      bot_active,
      days_active: daysActive
    });
  } catch (err) {
    console.error('Bot status error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});




// ===== DEPOSIT =====
app.post('/deposit', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || isNaN(amount)) return res.status(400).json({ message: 'Invalid amount' });

  try {
    await pool.query(`
      UPDATE users
      SET balance = balance + $1
      WHERE id = $2
    `, [amount, userId]);

    res.json({ message: `Deposited $${amount}` });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});



// GET /positions/me
// Query params:
// page (default 1), page_size (default 25, max 200)
// symbol, status (RUNNING|CLOSED|CANCELLED), date_from, date_to (ISO),
// min_pnl, max_pnl, side (BUY|SELL), sort_by (opened_at|closed_at|pnl|fees), sort_dir (asc|desc)
app.get('/positions/me', authenticate, async (req, res) => {
  const userId = req.user.id;
  const {
    page = '1',
    page_size = '25',
    symbol,
    status,
    side,
    date_from,
    date_to,
    min_pnl,
    max_pnl,
    sort_by = 'opened_at',
    sort_dir = 'desc'
  } = req.query;

  const p = Math.max(parseInt(page) || 1, 1);
  const ps = Math.min(Math.max(parseInt(page_size) || 25, 1), 200);
  const offset = (p - 1) * ps;

  const where = ['user_id = $1'];
  const vals = [userId];
  let i = vals.length + 1;

  if (symbol) { where.push(`symbol = $${i++}`); vals.push(symbol); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  if (side)   { where.push(`side = $${i++}`); vals.push(side); }
  if (date_from) { where.push(`COALESCE(closed_at, opened_at) >= $${i++}`); vals.push(new Date(date_from)); }
  if (date_to)   { where.push(`COALESCE(closed_at, opened_at) <= $${i++}`); vals.push(new Date(date_to)); }
  if (min_pnl)   { where.push(`pnl >= $${i++}`); vals.push(min_pnl); }
  if (max_pnl)   { where.push(`pnl <= $${i++}`); vals.push(max_pnl); }

  const sortable = new Set(['opened_at','closed_at','pnl','fees']);
  const sb = sortable.has(String(sort_by)) ? String(sort_by) : 'opened_at';
  const sd = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const countSql = `SELECT COUNT(*) AS cnt FROM positions ${whereSql}`;
    const { rows: [{ cnt }] } = await pool.query(countSql, vals);

    const sql = `
      SELECT id, symbol, side, qty, entry_price, exit_price, pnl, fees, status,
             opened_at, closed_at, duration_sec, strategy
      FROM positions
      ${whereSql}
      ORDER BY ${sb} ${sd}
      LIMIT ${ps} OFFSET ${offset}
    `;
    const { rows } = await pool.query(sql, vals);

    res.json({
      page: p,
      page_size: ps,
      total: Number(cnt),
      pages: Math.ceil(Number(cnt) / ps),
      data: rows
    });
  } catch (err) {
    console.error('GET /positions/me error', err);
    res.status(500).json({ message: 'Failed to fetch positions.' });
  }
});




// GET /positions/me/summary
app.get('/positions/me/summary', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { date_from, date_to, symbol, status, side } = req.query;

  const where = ['user_id = $1'];
  const vals = [userId];
  let i = vals.length + 1;

  if (symbol) { where.push(`symbol = $${i++}`); vals.push(symbol); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  if (side)   { where.push(`side = $${i++}`); vals.push(side); }
  if (date_from) { where.push(`COALESCE(closed_at, opened_at) >= $${i++}`); vals.push(new Date(date_from)); }
  if (date_to)   { where.push(`COALESCE(closed_at, opened_at) <= $${i++}`); vals.push(new Date(date_to)); }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  try {
    const kpisSql = `
      SELECT
        COUNT(*)::int AS total_trades,
        SUM(CASE WHEN status='CLOSED' THEN 1 ELSE 0 END)::int AS closed_trades,
        SUM(CASE WHEN pnl > 0 AND status='CLOSED' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN pnl <= 0 AND status='CLOSED' THEN 1 ELSE 0 END)::int AS losses,
        COALESCE(SUM(pnl),0) AS gross_pnl,
        COALESCE(SUM(fees),0) AS total_fees,
        COALESCE(SUM(pnl - fees),0) AS net_pnl,
        COALESCE(AVG(NULLIF(pnl,0)) FILTER (WHERE pnl > 0),0) AS avg_win,
        COALESCE(AVG(pnl) FILTER (WHERE pnl < 0),0) AS avg_loss,
        COALESCE(MAX(pnl),0) AS best_trade,
        COALESCE(MIN(pnl),0) AS worst_trade,
        COALESCE(AVG(duration_sec),0)::int AS avg_duration_sec,
        COALESCE(SUM(ABS(qty)),0) AS volume
      FROM positions
      ${whereSql}
    `;

    const { rows: [kpis] } = await pool.query(kpisSql, vals);
    const winRate = kpis.closed_trades > 0 ? (kpis.wins / kpis.closed_trades) : 0;

    // Daily net PnL for charts
    const dailySql = `
      SELECT date_trunc('day', COALESCE(closed_at, opened_at))::date AS day,
             SUM(COALESCE(pnl,0) - COALESCE(fees,0)) AS net_pnl
      FROM positions
      ${whereSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const { rows: daily } = await pool.query(dailySql, vals);

    // Build equity curve client-side or here
    let eq = 0; const equityCurve = daily.map(d => ({ day: d.day, equity: (eq += Number(d.net_pnl)) }));

    res.json({
      ...kpis,
      win_rate: winRate,
      daily,
      equity_curve: equityCurve
    });
  } catch (err) {
    console.error('GET /positions/me/summary error', err);
    res.status(500).json({ message: 'Failed to fetch positions summary.' });
  }
});




// GET /positions/me/export
app.get('/positions/me/export', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { symbol, status, side, date_from, date_to } = req.query;

  const where = ['user_id = $1'];
  const vals = [userId];
  let i = vals.length + 1;

  if (symbol) { where.push(`symbol = $${i++}`); vals.push(symbol); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  if (side)   { where.push(`side = $${i++}`); vals.push(side); }
  if (date_from) { where.push(`COALESCE(closed_at, opened_at) >= $${i++}`); vals.push(new Date(date_from)); }
  if (date_to)   { where.push(`COALESCE(closed_at, opened_at) <= $${i++}`); vals.push(new Date(date_to)); }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  try {
    const sql = `
      SELECT id, symbol, side, qty, entry_price, exit_price, pnl, fees, status,
             opened_at, closed_at, duration_sec, strategy
      FROM positions
      ${whereSql}
      ORDER BY opened_at DESC
    `;
    const { rows } = await pool.query(sql, vals);

    // CSV header
    let csv = 'id,symbol,side,qty,entry_price,exit_price,pnl,fees,status,opened_at,closed_at,duration_sec,strategy\n';
    for (const r of rows) {
      const line = [
        r.id, r.symbol, r.side, r.qty, r.entry_price, r.exit_price,
        r.pnl, r.fees, r.status,
        r.opened_at?.toISOString?.() || '',
        r.closed_at?.toISOString?.() || '',
        r.duration_sec || '',
        (r.strategy || '').replaceAll(',', ';')
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="positions.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /positions/me/export error', err);
    res.status(500).json({ message: 'Failed to export positions.' });
  }
});


// POST /positions (used by your bot)
// body: { symbol, side, qty, entry_price, exit_price, pnl, fees, status, opened_at, closed_at, strategy, notes }
app.post('/positions', authenticate, async (req, res) => {
  const userId = req.user.id;
  const {
    symbol, side, qty = 1, entry_price, exit_price = null, pnl = 0, fees = 0,
    status = 'RUNNING', opened_at = new Date(), closed_at = null, strategy = 'AI_BOT_V1', notes = null
  } = req.body;

  try {
    const durationSec = closed_at ? Math.round((new Date(closed_at) - new Date(opened_at)) / 1000) : null;
    const sql = `
      INSERT INTO positions (user_id, symbol, side, qty, entry_price, exit_price, pnl, fees, status, opened_at, closed_at, duration_sec, strategy, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `;
    const vals = [userId, symbol, side, qty, entry_price, exit_price, pnl, fees, status, opened_at, closed_at, durationSec, strategy, notes];
    const { rows: [row] } = await pool.query(sql, vals);
    res.json(row);
  } catch (err) {
    console.error('POST /positions error', err);
    res.status(500).json({ message: 'Failed to create position.' });
  }
});



// ===== Server Init =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Booting...');
  console.log(`Server running on port ${PORT}`);
});
