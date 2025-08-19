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

// === CRYPTO IMPORTS (add under your other requires) ===
const crypto = require('crypto');
const fetch = require('node-fetch'); // for TronGrid polling

let TronWeb = require('tronweb');
TronWeb = TronWeb && (TronWeb.default || TronWeb.TronWeb || TronWeb); // pick the constructor


const {
  Connection, Keypair, PublicKey, clusterApiUrl,
  sendAndConfirmTransaction, Transaction
} = require('@solana/web3.js');

const {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction
} = require('@solana/spl-token');


// ===== Setup SendGrid =====
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ===== PostgreSQL Connection =====
// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
// });
// ===== PostgreSQL Connection =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Force SSL for RDS (dev-safe). In prod, use the AWS CA cert instead.
  ssl: { rejectUnauthorized: false }
});



// === CRYPTO CONFIG & INIT ===
const ENC_KEY_HEX = process.env.ENCRYPTION_KEY; // 64 hex chars
if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
  console.error('ENCRYPTION_KEY missing or invalid (use `openssl rand -hex 32`)');
  process.exit(1);
}
const ENC_KEY = Buffer.from(ENC_KEY_HEX, 'hex');

const TRON_FULLHOST = process.env.TRON_FULLHOST || 'https://api.trongrid.io';
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || '';
const USDT_TRON_CONTRACT = process.env.USDT_TRON_CONTRACT || 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';

const SOLANA_RPC = process.env.SOLANA_RPC || clusterApiUrl('mainnet-beta');
const SOL_USDC_MINT = new PublicKey(process.env.SOL_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET || '';
const TRON_REQUIRED_CONFS = Number(process.env.TRON_REQUIRED_CONFS || 6);
const SOL_REQUIRED_FINALITY = 'finalized';
const SWEEP_DUST_THRESHOLD = Number(process.env.SWEEP_DUST_THRESHOLD || 0.5); // USDT, default 0.5

// Init SDKs
const tronWeb = new TronWeb({
  fullHost: TRON_FULLHOST,
  headers: TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_API_KEY } : {}
});
const solConn = new Connection(SOLANA_RPC, 'confirmed');

// === Small helpers ===
function aesEncrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64'); // iv(12)+tag(16)+enc
}
function aesDecrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.slice(0,12);
  const tag = buf.slice(12,28);
  const enc = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
async function withTx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
async function getUserBalance(userId) {
  const { rows } = await pool.query('SELECT balance FROM users WHERE id=$1', [userId]);
  return parseFloat(rows?.[0]?.balance || 0);
}
async function creditUserBalance(userId, amount) {
  await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2', [amount, userId]);
}
async function debitUserBalance(userId, amount) {
  await withTx(async (c) => {
    const { rows } = await c.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const cur = parseFloat(rows?.[0]?.balance || 0);
    if (cur < amount) throw new Error('Insufficient balance');
    await c.query('UPDATE users SET balance=$1 WHERE id=$2', [cur - amount, userId]);
  });
}

// Settings KV (used by Tron poller)
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0]?.value || null;
}
async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [key, String(value)]
  );
}

// Ensure the crypto tables exist (no-op if created already)
(async function bootstrapCryptoTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        network TEXT NOT NULL,
        token TEXT NOT NULL,
        address TEXT NOT NULL UNIQUE,
        token_account TEXT,
        priv_enc TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        network TEXT NOT NULL,
        token TEXT NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        from_addr TEXT,
        to_addr TEXT,
        amount NUMERIC(38,8) NOT NULL,
        confirmations INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        network TEXT NOT NULL,
        token TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        amount NUMERIC(38,8) NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    await pool.query(`
      ALTER TABLE deposits
      ADD COLUMN IF NOT EXISTS swept BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS sweep_tx_hash TEXT;
    
      ALTER TABLE withdrawals
      ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(38,8) DEFAULT 0;
    `);
    
    console.log('✅ Crypto tables ready');
  } catch (e) {
    console.error('DB bootstrap (crypto) failed:', e);
    process.exit(1);
  }
})();



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
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/webhooks/solana')) {
      req.rawBody = buf;
    }
  }
}));


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



// === WALLETS (TRON only) ===

// Create a new TRON wallet for a user
// POST /wallet/new  (body can be empty; defaults to tron)
// Create (or return existing) TRON wallet — enforce ONE per user
// Create (or return existing) TRON wallet — enforce ONE per user
app.post('/wallet/new', authenticate, async (req, res) => {
  try {
    // 0) If user already has a TRON wallet, just return it
    const { rows: existing } = await pool.query(
      `SELECT address
       FROM wallets
       WHERE user_id=$1 AND network='tron'
       ORDER BY id DESC
       LIMIT 1`,
      [req.user.id]
    );
    if (existing.length) {
      return res.json({ network: 'tron', token: 'USDT', address: existing[0].address });
    }

    // 1) Create a new TRON wallet
    let acct;
    try {
      acct = await tronWeb.createAccount();
    } catch (e) {
      console.error('tronWeb.createAccount() failed, falling back:', e?.message || e);
    }

    // 2) Fallback generation if needed
    if (!acct || !acct.privateKey) {
      const gen = TronWeb?.utils?.accounts?.generateAccount
        ? TronWeb.utils.accounts.generateAccount()
        : null;

      if (gen?.privateKey) {
        const base58 = tronWeb.address.fromPrivateKey(gen.privateKey);
        acct = {
          privateKey: gen.privateKey,
          address: {
            base58,
            hex: tronWeb.address.toHex(base58),
          }
        };
      }
    }

    if (!acct?.privateKey || !acct?.address?.base58) {
      throw new Error('Failed to generate TRON account (no privateKey/address)');
    }

    const address = acct.address.base58;
    const priv_enc = aesEncrypt(acct.privateKey); // hex -> encrypted

    await pool.query(
      `INSERT INTO wallets (user_id, network, token, address, priv_enc)
       VALUES ($1,'tron','USDT',$2,$3)`,
      [req.user.id, address, priv_enc]
    );

    return res.json({ network: 'tron', token: 'USDT', address });
  } catch (e) {
    console.error('wallet/new error:', e?.stack || e);
    res.status(500).json({ message: 'Internal server error', detail: String(e?.message || e) });
  }
});



// Get existing TRON wallet
// GET /wallet/tron
app.get('/wallet/:network', authenticate, async (req, res) => {
  const network = req.params.network;
  if (network !== 'tron') return res.status(400).json({ message: 'Unsupported network' });

  const { rows } = await pool.query(
    `SELECT network, token, address
     FROM wallets WHERE user_id=$1 AND network='tron'
     ORDER BY id DESC LIMIT 1`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'No wallet. Create one.' });
  res.json(rows[0]);
});




// ======= WITHDRAWAL (TRON USDT via OMNIBUS) =======
// Body: { network: 'tron', token: 'USDT', amount: number, to: string }
app.post('/withdraw', authenticate, async (req, res) => {
  try {
    const { network, token, amount, to } = req.body;

    // Hard validation: TRON USDT only
    if (network !== 'tron' || token !== 'USDT') {
      return res.status(400).json({ message: 'Use USDT on Tron' });
    }

    // Fail fast if omnibus not configured
    if (!OMNIBUS_TRON_PRIV || !OMNIBUS_TRON_ADDR) {
      return res.status(500).json({ message: 'Omnibus TRON not configured' });
    }

    // Validate destination address
    if (!tronWeb.isAddress(to)) {
      return res.status(400).json({ message: 'Invalid TRON address' });
    }

    // Integer math (micro-USDT)
    const grossU = Math.round(Number(amount) * 1e6);
    if (!grossU || grossU <= 0) return res.status(400).json({ message: 'Invalid amount' });

    const feeU = Math.max(Math.floor(grossU * 1 / 100), 1); // 1% fee, at least 1 micro
    const netU = grossU - feeU;

    if (netU <= 0) return res.status(400).json({ message: 'Amount too small after fee' });

    const MIN_NET_U = Math.round((Number(process.env.MIN_WITHDRAW_USDT || 1)) * 1e6);
    if (netU < MIN_NET_U) return res.status(400).json({ message: `Minimum net withdrawal is ${MIN_NET_U/1e6} USDT` });

    const gross = grossU / 1e6;
    const fee   = feeU   / 1e6;
    const net   = netU   / 1e6;

    // 1) Debit + create withdrawal row in a single transaction
    let wid;
    await withTx(async (c) => {
      // lock & check balance
      const { rows } = await c.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const cur = Number(rows?.[0]?.balance || 0);
      if (cur < gross) throw new Error('Insufficient balance');

      // debit gross
      await c.query('UPDATE users SET balance=$1 WHERE id=$2', [Number((cur - gross).toFixed(6)), req.user.id]);

      // create withdrawal row
      const ins = await c.query(
        `INSERT INTO withdrawals (user_id, network, token, to_addr, amount, fee_amount, status)
         VALUES ($1,'tron','USDT',$2,$3,$4,'requested') RETURNING id`,
        [req.user.id, to, gross, fee]
      );
      wid = ins.rows[0].id;
    });

    // 2) Check omnibus liquidity BEFORE broadcasting
    const avail = await tronUsdtBalanceOf(OMNIBUS_TRON_ADDR);
    if (avail < net) {
      // Re-credit and mark failed
      await withTx(async (c) => {
        await c.query(`UPDATE withdrawals SET status='failed' WHERE id=$1`, [wid]);
        await c.query(`UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2`, [gross, req.user.id]);
      });
      return res.status(400).json({ message: 'Insufficient omnibus liquidity' });
    }

    // 3) Broadcast from OMNIBUS (TRC-20)
    const contract = await tronUsdtContract();
    const amountSun = BigInt(netU).toString();

    let txSig;
    try {
      txSig = await contract.transfer(to, amountSun).send({ privateKey: OMNIBUS_TRON_PRIV });
    } catch (broadcastErr) {
      // Re-credit and mark failed if broadcast errors
      await withTx(async (c) => {
        await c.query(`UPDATE withdrawals SET status='failed' WHERE id=$1`, [wid]);
        await c.query(`UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2`, [gross, req.user.id]);
      });
      throw broadcastErr;
    }

    // 4) Update withdrawal status → broadcasted, then confirm async
    await pool.query(`UPDATE withdrawals SET tx_hash=$1, status='broadcasted' WHERE id=$2`, [txSig, wid]);

    setTimeout(async () => {
      try {
        await pool.query(`UPDATE withdrawals SET status='confirmed' WHERE id=$1`, [wid]);
      } catch (e) {
        console.error('withdraw confirm error', e);
      }
    }, 5000);

    res.json({ message: 'Withdrawal initiated', fee, net, tx_hash: txSig });
  } catch (e) {
    console.error('withdraw error', e);
    res.status(400).json({ message: e.message || 'Withdraw failed' });
  }
});





// ===== BALANCE (TRON USDT only, with breakdown) =====
app.get('/balance', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Total internal credited balance (source of truth for user funds)
    const total = await getUserBalance(userId);

    // Pending deposits (seen on-chain but not confirmed in app yet)
    const { rows: [pDep] } = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS sum
       FROM deposits
       WHERE user_id=$1
         AND network='tron' AND token='USDT'
         AND status != 'confirmed'`,
      [userId]
    );
    const pending_deposits = Number(pDep.sum || 0);

    // Confirmed but NOT yet swept to omnibus (still at user deposit address)
    const { rows: [cUnswept] } = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS sum
       FROM deposits
       WHERE user_id=$1
         AND network='tron' AND token='USDT'
         AND status='confirmed' AND (swept IS NOT TRUE)`,
      [userId]
    );
    const confirmed_unswept = Number(cUnswept.sum || 0);

    // Confirmed AND swept to omnibus
    const { rows: [cSwept] } = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS sum
       FROM deposits
       WHERE user_id=$1
         AND network='tron' AND token='USDT'
         AND status='confirmed' AND swept IS TRUE`,
      [userId]
    );
    const confirmed_swept = Number(cSwept.sum || 0);

    // Pending withdrawals (requested or broadcasted but not confirmed yet)
    const { rows: [pWdr] } = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS sum
       FROM withdrawals
       WHERE user_id=$1
         AND network='tron' AND token='USDT'
         AND status IN ('requested','broadcasted')`,
      [userId]
    );
    const pending_withdrawals = Number(pWdr.sum || 0);

    // Withdrawable now (no 30-day locks yet): total minus pending withdrawals
    const withdrawable = Math.max(Number((total - pending_withdrawals).toFixed(6)), 0);

    // Optional: when did we last poll Tron?
    const last_poll_ts = await getSetting('tron_since_ts');

    res.json({
      currency: 'USDT',
      chain: 'tron',
      total_usd: Number(total.toFixed(6)),
      pending_deposits_usd: Number(pending_deposits.toFixed(6)),
      confirmed_unswept_usd: Number(confirmed_unswept.toFixed(6)),
      confirmed_swept_usd: Number(confirmed_swept.toFixed(6)),
      pending_withdrawals_usd: Number(pending_withdrawals.toFixed(6)),
      withdrawable_usd: withdrawable,
      meta: { last_tron_poll_ts: last_poll_ts ? Number(last_poll_ts) : null }
    });
  } catch (e) {
    console.error('GET /balance error:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});





// === OMNIBUS HOT WALLET (TRON only) ===
const OMNIBUS_TRON_PRIV = process.env.OMNIBUS_TRON_PRIVATE_KEY || null;  // hex
const OMNIBUS_TRON_ADDR = process.env.OMNIBUS_TRON_ADDRESS || null;      // base58

// === Token helpers (TRON) ===
async function tronUsdtContract() {
  return await tronWeb.contract().at(USDT_TRON_CONTRACT);
}
async function tronUsdtBalanceOf(base58Addr) {
  const c = await tronUsdtContract();
  const raw = await c.balanceOf(tronWeb.address.toHex(base58Addr)).call();
  return Number(raw?.toString?.()) / 1e6; // 6 decimals
}




// === DEPOSITS: detect TRON USDT credits (poller) ===

// Convert TronGrid event address → base58 "T..." for DB matching
function eventToBase58(addr) {
  if (!addr) return null;
  try {
    if (addr.startsWith('0x') && addr.length === 42) {
      return tronWeb.address.fromHex('41' + addr.slice(2));
    }
    if (addr.startsWith('41') && addr.length === 42) {
      return tronWeb.address.fromHex(addr);
    }
    if (addr.startsWith('T')) return addr; // already base58
  } catch (_) {}
  return null;
}

// Upsert a deposit row
async function upsertDeposit(d) {
  const { user_id, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status } = d;
  try {
    await pool.query(
      `INSERT INTO deposits (user_id, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tx_hash) DO UPDATE
         SET confirmations = EXCLUDED.confirmations,
             status        = EXCLUDED.status`,
      [user_id, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status]
    );
  } catch (e) { console.error('upsertDeposit', e); }
}

// Mark confirmed and credit internal balance
async function confirmAndCredit(tx_hash) {
  await withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM deposits WHERE tx_hash=$1 FOR UPDATE', [tx_hash]);
    if (!rows.length) return;
    const d = rows[0];
    if (d.status === 'confirmed') return;
    await c.query('UPDATE deposits SET status=$1 WHERE tx_hash=$2', ['confirmed', tx_hash]);
    await c.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2', [Number(d.amount), d.user_id]);
  });
}

// Poll TronGrid TRC20 events and credit matching user deposit addresses
async function pollTron() {
  try {
    const sinceTs = Number(await getSetting('tron_since_ts')) || 0;

    const u = new URL(`${TRON_FULLHOST}/v1/contracts/${USDT_TRON_CONTRACT}/events`);
    u.searchParams.set('event_name', 'Transfer');
    if (sinceTs) u.searchParams.set('min_timestamp', String(sinceTs));
    u.searchParams.set('limit', '200');

    const headers = TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_API_KEY } : {};
    const resp = await fetch(u.toString(), { headers });
    if (!resp.ok) { console.error('Tron poll http', resp.status); return; }

    const data = await resp.json();
    const events = data?.data || [];
    console.log(`[pollTron] fetched ${events.length} events`);

    // map our base58 deposit addresses -> user_id
    const { rows: tronWallets } = await pool.query(
      `SELECT user_id, address FROM wallets WHERE network='tron' AND token='USDT'`
    );
    const addrToUser = new Map(tronWallets.map(w => [w.address, w.user_id]));

    let maxTs = sinceTs;

    for (const ev of events) {
      const ts = Number(ev.block_timestamp || 0);
      if (ts > maxTs) maxTs = ts;

      const tx       = ev.transaction_id;
      const fromEv   = ev.result?.from;
      const toEv     = ev.result?.to;
      const valueRaw = ev.result?.value; // string (6 decimals for USDT)
      if (!tx || !toEv || valueRaw == null) continue;

      const toBase58   = eventToBase58(toEv);
      const fromBase58 = eventToBase58(fromEv);
      if (!toBase58) continue;

      const userId = addrToUser.get(toBase58);
      if (!userId) continue; // not one of ours

      const amount = Number(valueRaw) / 1e6;
      console.log('[pollTron] match', { tx, toBase58, amount });

      await upsertDeposit({
        user_id: userId,
        network: 'tron',
        token: 'USDT',
        tx_hash: tx,
        from_addr: fromBase58 || null,
        to_addr: toBase58,
        amount,
        confirmations: TRON_REQUIRED_CONFS,
        status: 'pending'
      });

      // MVP: confirm immediately (prod: wait real confs)
      await confirmAndCredit(tx);
    }

    await setSetting('tron_since_ts', maxTs);
  } catch (e) {
    console.error('pollTron error', e?.message || e);
  }
}

// run poller every ~20s
setInterval(pollTron, 20_000);

// manual trigger
app.get('/deposits/tron/refresh', async (_req, res) => {
  try {
    await pollTron();
    res.json({ ok: true });
  } catch (e) {
    console.error('manual pollTron error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});






// ========== SWEEPER (TRON only, every 60s) ==========
async function sweepTronOnce() {
  if (!OMNIBUS_TRON_PRIV || !OMNIBUS_TRON_ADDR) return;

  try {
    const contract = await tronUsdtContract();
    const { rows: tronWallets } = await pool.query(
      `SELECT id, user_id, address, priv_enc
       FROM wallets
       WHERE network='tron' AND token='USDT'`
    );

    for (const w of tronWallets) {
      const addr = w.address;
      if (addr === OMNIBUS_TRON_ADDR) continue; // don't sweep the omnibus itself, safety

      let bal;
      try {
        bal = await tronUsdtBalanceOf(addr);
      } catch (e) {
        console.error('Tron balanceOf failed for', addr, e?.message || e);
        continue;
      }
      if (!bal || bal < SWEEP_DUST_THRESHOLD) continue; // skip dust

      try {
        const amountSun = BigInt(Math.floor(bal * 1e6)).toString();
        const perUserPrivHex = aesDecrypt(w.priv_enc); // user deposit privkey (hex)

        const tx = await contract.transfer(OMNIBUS_TRON_ADDR, amountSun)
          .send({ privateKey: perUserPrivHex });

        await pool.query(
          `UPDATE deposits SET swept=true, sweep_tx_hash=$1
           WHERE to_addr=$2 AND network='tron' AND token='USDT'`,
          [tx, addr]
        );
        console.log(`🔁 Swept TRON USDT ${bal} from ${addr} -> ${OMNIBUS_TRON_ADDR} tx=${tx}`);
      } catch (e) {
        console.error(`TRON sweep failed for ${addr}:`, e?.message || e);
      }
    }
  } catch (e) {
    console.error('sweepTronOnce fatal:', e?.message || e);
  }
}

setInterval(sweepTronOnce, 60_000);

app.get('/deposits/tron/refresh', async (_req, res) => {
  try {
    await pollTron();
    res.json({ ok: true });
  } catch (e) {
    console.error('manual pollTron error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});



// ===== Server Init =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Booting...');
  console.log(`Server running on port ${PORT}`);
});
