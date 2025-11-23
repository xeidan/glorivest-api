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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// === CRYPTO IMPORTS (add under your other requires) ===


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


const WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET || '';
const TRON_REQUIRED_CONFS = Number(process.env.TRON_REQUIRED_CONFS || 6);
const SOL_REQUIRED_FINALITY = 'finalized';
const SWEEP_DUST_THRESHOLD = Number(process.env.SWEEP_DUST_THRESHOLD || 0.5); // USDT, default 0.5



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

// === DB bootstrap: crypto + accounts (idempotent) ===
(async function bootstrapCryptoTables() {
  try {
    await pool.query('BEGIN');

    // 1) Core crypto tables (yours, unchanged in shape)
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

      CREATE TABLE IF NOT EXISTS payments (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        account_id BIGINT,
        amount_cents BIGINT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        provider TEXT,
        provider_ref TEXT UNIQUE,
        checkout_url TEXT,
        status TEXT NOT NULL DEFAULT 'initiated',
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);


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

    // 2) Accounts/Tiers tables (new)
    await pool.query(`
      -- Tiers
      CREATE TABLE IF NOT EXISTS account_tiers (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL CHECK (code IN ('standard','pro','elite')),
        display_name TEXT NOT NULL,
        return_percent INT NOT NULL,
        min_deposit_cents INT NOT NULL,
        fee_cents INT NOT NULL
      );

      -- Per-user accounts
      CREATE TABLE IF NOT EXISTS accounts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        tier_id INT NOT NULL REFERENCES account_tiers(id),
        account_code TEXT NOT NULL UNIQUE,           -- e.g. GV150123-01 (UI may prefix "#")
        status TEXT NOT NULL DEFAULT 'active',
        balance_cents BIGINT NOT NULL DEFAULT 0,
        profit_cents  BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Account-scoped wallets (for UI linking)
      CREATE TABLE IF NOT EXISTS account_wallets (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        asset TEXT NOT NULL,
        network TEXT NOT NULL,
        symbol TEXT NOT NULL,
        address TEXT NOT NULL UNIQUE,
        priv_enc TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
// 
    await pool.query(`
      ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS account_id bigint;
      DO $$
      BEGIN
        ALTER TABLE withdrawals
          ADD CONSTRAINT withdrawals_account_fk
          FOREIGN KEY (account_id) REFERENCES accounts(id)
          ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END$$;
      CREATE INDEX IF NOT EXISTS withdrawals_account_id_idx ON withdrawals(account_id);
    `);
    
// 
// --- normalize withdrawals table to what /withdraw uses ---
await pool.query(`
  -- add missing columns safely
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS account_id     bigint;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS amount_cents   bigint;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee_cents      bigint DEFAULT 0;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS net_cents      bigint;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS currency       text   DEFAULT 'usd';
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS address        text;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS status         text   DEFAULT 'pending';
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS tx_hash        text;
  ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT NOW();

  -- FK and index (tolerant of reboots)
  DO $$
  BEGIN
    ALTER TABLE withdrawals
      ADD CONSTRAINT withdrawals_account_fk
      FOREIGN KEY (account_id) REFERENCES accounts(id)
      ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END$$;

  CREATE INDEX IF NOT EXISTS withdrawals_account_id_idx ON withdrawals(account_id);
`);



    // 3) Bring legacy tables up-to-date (safe with IF NOT EXISTS)
    await pool.query(`
      -- deposits: your existing extras
      ALTER TABLE deposits
        ADD COLUMN IF NOT EXISTS swept BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS sweep_tx_hash TEXT;

      -- withdrawals: your existing extra fee column
      ALTER TABLE withdrawals
        ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(38,8) DEFAULT 0;

      -- wallets: columns used by poller/sweeper + link to accounts
      ALTER TABLE wallets
        ADD COLUMN IF NOT EXISTS sweep_enabled BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id);

      -- deposits: link rows to a specific account (nullable)
      ALTER TABLE deposits
        ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id);
    `);

    // 4) Helpful indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS account_wallets_account_id_idx ON account_wallets(account_id);
      CREATE INDEX IF NOT EXISTS deposits_user_acct_idx ON deposits(user_id, account_id);
    `);

    await pool.query('COMMIT');
    console.log('✅ Crypto + Accounts tables ready');

    // 5) Seed/refresh tiers
    await ensureTierSeed();
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch {}
    console.error('DB bootstrap failed:', e);
    process.exit(1);
  }
})();

// Seed/refresh tiers once (idempotent)
async function ensureTierSeed() {
  await pool.query(`
    INSERT INTO account_tiers (code, display_name, return_percent, min_deposit_cents, fee_cents)
    VALUES 
      ('standard','Standard Account',15,   2000,    0),
      ('pro',     'Pro Account',     20,  20000, 2000),
      ('elite',   'Elite Account',   25, 100000, 5000)
    ON CONFLICT (code) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          return_percent = EXCLUDED.return_percent,
          min_deposit_cents = EXCLUDED.min_deposit_cents,
          fee_cents = EXCLUDED.fee_cents;
  `);
}




// ===== CORS Config =====
const allowedOrigins = [
  'https://glorivest.com',
  'https://www.glorivest.com',
  'http://localhost:3000',
  'http://127.0.0.1:5503'
];



app.use(cors({
  origin: function (origin, callback) {

    if (!origin) return callback(null, true); // mobile apps, curl, etc.

    // Allow production
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow ALL localhost and 127.*.*.* ports
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }

    console.error("❌ Blocked by CORS:", origin);
    return callback(new Error('Not allowed by CORS'));
  },

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());






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


// ===== AUTH MIDDLEWARE (drop-in) =====
function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ message: 'Missing or invalid token' });

  try {
    const decoded = jwt.verify(m[1], process.env.JWT_SECRET);
    const id = decoded.userId ?? decoded.id ?? decoded.sub;
    if (!id) return res.status(401).json({ message: 'Token missing user id' });
    req.user = { id: Number(id), email: decoded.email ?? null, role: decoded.role ?? 'user', ...decoded };
    next();
  } catch (err) {
    return res.status(401).json({ message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid or expired token' });
  }
}




// ===== ACCOUNT ME =====
app.get("/account/me", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows: [user] } = await pool.query(`
      SELECT id, email, balance, reward_balance, referral_code, total_referrals, referral_earnings
      FROM users
      WHERE id = $1
    `, [userId]);

    if (!user) return res.status(404).json({ message: "User not found" });

    // First (oldest) account as the default
    const { rows: [acct] } = await pool.query(`
      SELECT id AS account_id, account_code
      FROM accounts
      WHERE user_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `, [userId]);

    res.json({
      user_id: user.id,
      email: user.email,
      glorivest_id: `GV${150000 + user.id}`,
      balance: Number(user.balance || 0),
      reward_balance: Number(user.reward_balance || 0),
      referral_code: user.referral_code || "N/A",
      total_referrals: user.total_referrals || 0,
      referral_earnings: Number(user.referral_earnings || 0),
      default_account_id: acct?.account_id ?? null,
      default_account_code: acct?.account_code ?? null
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
      from: process.env.FROM_EMAIL || 'no-reply@glorivest.com',
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



const EmailTpl = {
  welcome: ({ email }) => `
    <div style="font-family:sans-serif">
      <h2>Welcome to Glorivest 🎉</h2>
      <p>Your email <b>${email}</b> is verified. You can deposit and start earning.</p>
    </div>
  `,

  // Used by crypto deposit flow: EmailTpl.depositConfirmed({ amount, tx })
  depositConfirmed: ({ amount, tx }) => `
    <div style="font-family:sans-serif">
      <h2>Deposit Confirmed</h2>
      <p>We received <b>${amount} USDT</b>.</p>
      <p>Tx: <code>${tx}</code></p>
    </div>
  `,

  // Used by /withdraw route: pass dest (address) + optional currency
  withdrawalRequested: ({ amount, currency = 'USDT', dest }) => `
    <div style="font-family:sans-serif">
      <h2>Withdrawal Request Received</h2>
      <p>Amount: <b>${currency} ${amount}</b></p>
      <p>Destination: <code>${dest}</code></p>
    </div>
  `,

  // Used when TX is broadcast
  withdrawalBroadcasted: ({ amount, tx }) => `
    <div style="font-family:sans-serif">
      <h2>Withdrawal Broadcasted</h2>
      <p>Sent <b>${amount} USDT</b>.</p>
      <p>Tx: <code>${tx}</code></p>
    </div>
  `,

  // Used when TX is confirmed
  withdrawalConfirmed: ({ amount, tx }) => `
    <div style="font-family:sans-serif">
      <h2>Withdrawal Confirmed</h2>
      <p>Paid out <b>${amount} USDT</b>.</p>
      <p>Tx: <code>${tx}</code></p>
    </div>
  `,

  // Used on failure (broadcast or confirm stage)
  withdrawalFailed: ({ amount, reason }) => `
    <div style="font-family:sans-serif">
      <h2>Withdrawal Failed</h2>
      <p>Amount: <b>${amount} USDT</b></p>
      <p>Reason: ${reason || 'Unknown'}</p>
    </div>
  `
};



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
      from: process.env.FROM_EMAIL || 'no-reply@glorivest.com',
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

// ========== EMAIL TEMPLATES & SENDER ==========
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@glorivest.com';

async function sendMailSafe({ to, subject, html }) {
  try {
    if (!to) return;
    await sgMail.send({ to, from: FROM_EMAIL, subject, html });
  } catch (e) {
    console.error('[email] send failed:', subject, to, e?.message || e);
  }
}





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

// =========================
// Forgot Password
// =========================
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const { rows } = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
  if (!rows.length) {
    return res.json({ message: 'If that email exists, OTP has been sent' });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + (15 * 60 * 1000); // 15 mins

  await pool.query(`
    INSERT INTO password_resets (email, otp, expires)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET otp=$2, expires=$3
  `, [email, otp, expires]);

  await sgMail.send({
    to: email,
    from: process.env.FROM_EMAIL,
    subject: "Glorivest Password Reset Code",
    html: `<p>Your password reset OTP:</p><h2>${otp}</h2><p>Expires in 15 minutes</p>`
  });

  res.json({ message: 'OTP sent to email' });
});




// =========================
// Verify Reset
// =========================
app.post('/verify-reset', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const { rows } = await pool.query(
    'SELECT otp, expires FROM password_resets WHERE email=$1',
    [email]
  );
  if (!rows.length) return res.status(400).json({ message: 'Invalid reset request' });

  const rec = rows[0];

  if (rec.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });
  if (Date.now() > Number(rec.expires)) {
    return res.status(400).json({ message: 'OTP expired' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hashed, email]);
  await pool.query('DELETE FROM password_resets WHERE email=$1', [email]);

  return res.json({ message: 'Password reset successful' });
});





// =========================
// Verify OTP
// =========================
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  // Clean up any old unverified users
  await deleteOldUnverifiedUsers();

  try {
    // Fetch user + OTP info
    const { rows } = await pool.query(
      'SELECT id, otp, otp_created_at, is_verified FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.is_verified) return res.status(400).json({ message: 'User already verified' });

    // Check OTP validity
    const sentAt = new Date(user.otp_created_at);
    const ageMin = (Date.now() - sentAt.getTime()) / (1000 * 60);
    if (ageMin > 10) {
      return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // ✅ Mark verified + clear OTP
    await pool.query(
      'UPDATE users SET otp=NULL, otp_created_at=NULL, is_verified=true WHERE email=$1',
      [email]
    );

    // ✅ Ensure default Standard account exists
    await pool.query(`
      INSERT INTO accounts (user_id, tier_id, account_code)
      SELECT $1, t.id, $2
        FROM account_tiers t
       WHERE t.code='standard'
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id=$1)
    `, [user.id, genAccountCode(user.id, 1)]);

    // ✅ Send welcome email
    try {
      await sendMailSafe({
        to: email,
        subject: 'Welcome to Glorivest 🎉',
        html: EmailTpl.welcome({ email })
      });
    } catch (mailErr) {
      console.error('Welcome email error:', mailErr?.message || mailErr);
    }

    return res.status(200).json({ message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});


// SEND OTP FOR RESET PASSWORD
app.post('/auth/request-reset', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const { rows } = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "No account found with that email" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP
    await pool.query(
      "INSERT INTO password_resets (email, otp) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET otp=$2",
      [email, otp]
    );

    // Send Email
    await sgMail.send({
      to: email,
      from: process.env.FROM_EMAIL,
      subject: "Your Glorivest Password Reset OTP",
      text: `Your OTP is ${otp}`,
      html: `<h1>Your OTP is ${otp}</h1>`
    });

    return res.json({ message: "OTP sent" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});



//verify otp
app.post('/auth/verify-reset-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email & OTP required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT otp FROM password_resets WHERE email=$1",
      [email]
    );

    if (rows.length === 0 || rows[0].otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    return res.json({ message: "OTP verified" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Server error" });
  }
});



//set new password
app.post('/auth/set-new-password', async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({ message: "Email & new password required" });
  }

  try {
    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET password=$1 WHERE email=$2",
      [hash, email]
    );

    // Delete OTP after success
    await pool.query("DELETE FROM password_resets WHERE email=$1", [email]);

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Server error" });
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




// ===== EXCHANGE RATES ROUTE =====
// These rates can later be stored in DB or admin panel.
// For now, we use defaults and allow overriding via env.

const defaultRates = {
  USD: 1,
  NGN: Number(process.env.RATE_NGN || 1500),   // default 1500
  GBP: Number(process.env.RATE_GBP || 0),     // set later
  EUR: Number(process.env.RATE_EUR || 0)      // set later
};

app.get('/rates', async (req, res) => {
  try {
    // If later you load admin rates from DB:
    // const adminRates = await db.Rates.findOne();
    // return res.json({ rates: adminRates });

    return res.json({ rates: defaultRates });
  } catch (err) {
    console.error('Rates route error:', err);
    res.status(500).json({ message: 'Could not fetch rates' });
  }
});




app.get('/rates', async (req, res) => {
  try {
    return res.json({ rates: defaultRates });
  } catch (err) {
    console.error('Rates route error:', err);
    res.status(500).json({ message: 'Could not fetch rates' });
  }
});



// ===== CREATE DEPOSIT REFERENCE =====
app.post('/deposits/reference', async (req, res) => {
  try {
    const account_id = req.body.account_id;
    if (!account_id) {
      return res.status(400).json({ message: 'account_id required' });
    }

    // generate backend reference
    const ref = 'GV' + Math.floor(100000 + Math.random() * 900000);

    // OPTIONAL: save to DB for later matching
    // await db.DepositReference.create({ account_id, reference: ref });

    return res.json({ reference: ref });
  } catch (err) {
    console.error('Reference generation error:', err);
    res.status(500).json({ message: 'Cannot generate reference' });
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
// Create (or rotate) a TRON USDT deposit wallet for the user
// === WALLETS (TRON only) ===
// POST /wallet/new
app.post('/wallet/new', authenticate, async (req, res) => {
  try {
    // If user already has a TRON/USDT wallet with a stored key, return it
    const { rows: existing } = await pool.query(
      `SELECT id, user_id, account_id, network, token, address, priv_enc, sweep_enabled
         FROM wallets
        WHERE user_id = $1 AND network='tron' AND token='USDT'`,
      [req.user.id]
    );
    const current = existing[0];
    if (current && current.priv_enc && current.address) {
      return res.json({
        user_id: current.user_id,
        address: current.address,
        network: 'tron',
        token: 'USDT',
        sweep_enabled: current.sweep_enabled
      });
    }

    // Otherwise, generate a new wallet and store its key
    // You should replace this with your real key generator / KMS
    const { address, privEnc } = await generateTronWalletWithEncryptedKey(); // { address: 'T...', privEnc: '<encrypted>' }

    const { rows: [wallet] } = await pool.query(`
      INSERT INTO wallets (user_id, network, token, address, priv_enc, sweep_enabled)
      VALUES ($1, 'tron', 'USDT', $2, $3, true)
      ON CONFLICT (user_id) DO UPDATE
         SET address       = EXCLUDED.address,
             priv_enc      = COALESCE(wallets.priv_enc, EXCLUDED.priv_enc),
             sweep_enabled = EXCLUDED.sweep_enabled
      RETURNING user_id, address, network, token, sweep_enabled
    `, [req.user.id, address, privEnc]);

    return res.json(wallet);
  } catch (e) {
    console.error('wallet/new error:', e?.stack || e);
    return res.status(500).json({ message: 'Failed to create wallet' });
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




// ======= WITHDRAWAL (TRON USDT) =======
// POST /withdraw
app.post('/withdraw', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { amount, address, account_id } = req.body || {};

  // cents-first math to avoid float drift
  const amtCents = Math.round(Number(amount || 0) * 100);
  const feeCents = Math.round(amtCents * 0.01); // 1% demo fee
  const totalCents = amtCents + feeCents;

  if (!amtCents || amtCents < 2000) {
    return res.status(400).json({ message: 'Minimum withdrawal is $20' });
  }
  if (!address || !/^T[a-zA-Z0-9]{20,}$/.test(address)) {
    return res.status(400).json({ message: 'Invalid TRON address' });
  }

  // numeric columns the table still requires
  const amountNumeric = amtCents / 100; // matches withdrawals.amount (numeric)
  const feeNumeric    = feeCents / 100; // matches withdrawals.fee_amount (numeric)

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve account: prefer provided, else user’s most recent
    let accId = Number(account_id) || null;
    if (!accId) {
      const { rows } = await client.query(
        `SELECT id FROM accounts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (!rows.length) throw new Error('No account for user');
      accId = rows[0].id;
    }

    // Ensure account belongs to user and has funds (and lock the row)
    const { rows: accRows } = await client.query(
      `SELECT id, balance_cents FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [accId, userId]
    );
    if (!accRows.length) throw new Error('Account not found for user');

    const bal = Number(accRows[0].balance_cents || 0);
    if (bal < totalCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Insert withdrawal using the actual column names in your DB:
    // id | user_id | network | token | to_addr | amount | tx_hash | status | created_at | fee_amount | account_id | amount_cents
    const { rows: wRows } = await client.query(
      `INSERT INTO withdrawals
         (user_id, account_id, network, token, to_addr, amount, amount_cents, fee_amount, status)
       VALUES
         ($1,      $2,         'tron', 'USDT', $3,      $4,     $5,           $6,         'pending')
       RETURNING id`,
      [userId, accId, address, amountNumeric, amtCents, feeNumeric]
    );

    // Deduct the total (amount + fee) from the account (in cents)
    await client.query(
      `UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id=$2`,
      [totalCents, accId]
    );

    await client.query('COMMIT');

    try {
      const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
      await sendMailSafe({
        to: u.email,
        subject: 'Withdrawal Requested',
        html: EmailTpl.withdrawalRequested({ amount: amountNumeric, address }),
      });
    } catch (e) {
      console.error('[email] withdrawalRequested:', e?.message || e);
    }

    
    return res.json({
      id: wRows[0].id,
      fee: feeNumeric,
      net: amountNumeric, // net to the user before network fee payout logic
      message: 'Withdrawal request submitted'
    });
  } catch (err) {
    console.error('withdraw error:', err);
    try { await client.query('ROLLBACK'); } catch {}
    return res.status(500).json({ message: 'Withdrawal failed' });
  } finally {
    client.release();
  }
});






// ===== BALANCE (TRON USDT only, with breakdown) =====
// Helper: safe SUM(amount) with logging
async function safeSumAmount(sql, params) {
  try {
    const { rows: [r] } = await pool.query(sql, params);
    return Number(r?.sum || 0);
  } catch (e) {
    console.error('[balance] sum query failed:', e);
    return 0;
  }
}

app.get('/balance', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Source of truth for user funds (internal ledger)
    const total = Number(await getUserBalance(userId)) || 0;

    // Pending deposits: seen but not confirmed
    const pending_deposits = await safeSumAmount(
      `SELECT COALESCE(SUM(amount),0) AS sum
         FROM deposits
        WHERE user_id=$1
          AND network='tron' AND token='USDT'
          AND status <> 'confirmed'`,
      [userId]
    );

    // Confirmed, still sitting at user deposit address
    const confirmed_unswept = await safeSumAmount(
      `SELECT COALESCE(SUM(amount),0) AS sum
         FROM deposits
        WHERE user_id=$1
          AND network='tron' AND token='USDT'
          AND status='confirmed' AND (swept IS NOT TRUE)`,
      [userId]
    );

    // Confirmed and already swept to omnibus
    const confirmed_swept = await safeSumAmount(
      `SELECT COALESCE(SUM(amount),0) AS sum
         FROM deposits
        WHERE user_id=$1
          AND network='tron' AND token='USDT'
          AND status='confirmed' AND swept IS TRUE`,
      [userId]
    );

    // Pending withdrawals: requested/broadcasted but not finalized
    const pending_withdrawals = await safeSumAmount(
      `SELECT COALESCE(SUM(amount),0) AS sum
         FROM withdrawals
        WHERE user_id=$1
          AND network='tron' AND token='USDT'
          AND status IN ('pending','broadcasted')`,
      [userId]
    );
    

    // Available to withdraw now (no locks modeled here)
    const withdrawable = Math.max(Number((total - pending_withdrawals).toFixed(6)), 0);

    // Last Tron poll timestamp (ms since epoch)
    const last_poll_raw = await getSetting('tron_since_ts');
    const last_poll_ts = last_poll_raw ? Number(last_poll_raw) : null;

    res.json({
      currency: 'USDT',
      chain: 'tron',
      total_usd: Number(total.toFixed(6)),
      pending_deposits_usd: Number(pending_deposits.toFixed(6)),
      confirmed_unswept_usd: Number(confirmed_unswept.toFixed(6)),
      confirmed_swept_usd: Number(confirmed_swept.toFixed(6)),
      pending_withdrawals_usd: Number(pending_withdrawals.toFixed(6)),
      withdrawable_usd: withdrawable,
      meta: { last_tron_poll_ts: Number.isFinite(last_poll_ts) ? last_poll_ts : null }
    });
  } catch (e) {
    console.error('GET /balance error:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});






// === OMNIBUS HOT WALLET (TRON only) ===
const OMNIBUS_TRON_PRIV = (process.env.OMNIBUS_TRON_PRIVATE_KEY || '').trim();  // hex
const OMNIBUS_TRON_ADDR = (process.env.OMNIBUS_TRON_ADDRESS || '').trim();      // base58

// === Trimmed + canonical TRON config (keep ONLY this set) ===
const TRON_FULLHOST = (process.env.TRON_FULLHOST || 'https://api.trongrid.io').trim();
const TRONGRID_API_KEY = (process.env.TRONGRID_API_KEY || '').trim();
const USDT_TRON_CONTRACT = (process.env.USDT_TRON_CONTRACT || 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8').trim();
const TRON_HEADERS = TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': TRONGRID_API_KEY } : {};

// Init SDK (use the same headers everywhere)
const tronWeb = new TronWeb({
  fullHost: TRON_FULLHOST,
  headers: TRON_HEADERS
});


// === Token helpers (TRON) — SINGLE SOURCE OF TRUTH ===
async function tronUsdtContract() {
  return tronWeb.contract().at(USDT_TRON_CONTRACT);
}

/**
 * Prefer base58 address, and pass `{ from: base58 }` to .call()
 * Falls back to TronGrid /v1/accounts/{addr}/tokens if node call fails/returns 0.
 */
async function tronUsdtBalanceOf(base58Addr) {
  const c = await tronUsdtContract();
  try {
    tronWeb.setAddress(base58Addr);                          // set owner context
    const hex = tronWeb.address.toHex(base58Addr);           // pass hex to balanceOf
    const raw = await c.balanceOf(hex).call({ from: base58Addr });
    const s = raw && raw._hex ? BigInt(raw._hex).toString() : (raw?.toString?.() ?? '0');
    const val = Number(s) / 1e6;
    if (Number.isFinite(val) && val > 0) return val;
    return await tronUsdtBalanceOfViaTronGrid(base58Addr);
  } catch (e) {
    return await tronUsdtBalanceOfViaTronGrid(base58Addr);
  }
}



async function tronUsdtBalanceOfViaTronGrid(base58Addr) {
  const url = new URL(`${TRON_FULLHOST}/v1/accounts/${base58Addr}/tokens`);
  url.searchParams.set('contract_address', USDT_TRON_CONTRACT);
  const resp = await fetch(url.toString(), { headers: TRON_HEADERS });
  if (resp.status === 404) return 0;          // empty account → zero balance
  if (!resp.ok) throw new Error(`TronGrid tokens HTTP ${resp.status}`);
  const json = await resp.json();
  const tok = (json?.data || []).find(x => (x?.tokenId || '').trim() === USDT_TRON_CONTRACT);
  if (!tok) return 0;
  const dec = Number(tok.tokenDecimal ?? 6);
  const bal = Number(tok.balance || 0);
  return bal / (10 ** dec);
}


// ======= Tron helpers for withdrawals =======
async function tronBroadcastUSDT({ to, amountUSDT }) {
  // amountUSDT -> sun (6 decimals)
  const contract = await tronUsdtContract();
  const sun = BigInt(Math.floor(Number(amountUSDT) * 1e6)).toString();

  tronWeb.setAddress(OMNIBUS_TRON_ADDR); // sender
  const txHash = await contract
    .transfer(to, sun)
    .send({ privateKey: OMNIBUS_TRON_PRIV }); // sign with omnibus
  return txHash; // string
}

async function tronGetReceipt(txHash) {
  try {
    const info = await tronWeb.trx.getTransactionInfo(txHash);
    // If not found yet, info may be empty object
    if (!info || Object.keys(info).length === 0) return { found: false };
    // result codes: 'SUCCESS' when confirmed
    const ok = (info?.receipt?.result || '').toUpperCase() === 'SUCCESS';
    return { found: true, ok, block: info.blockNumber || null };
  } catch (e) {
    return { found: false, error: e?.message || String(e) };
  }
}

// ======= Withdrawal broadcaster + confirmer =======
async function processWithdrawalsOnce() {
  if (!OMNIBUS_TRON_PRIV || !OMNIBUS_TRON_ADDR) return;

  // 1) Broadcast up to N pending withdrawals if we can
  const N = 10;
  try {
    const { rows: pend } = await pool.query(
      `SELECT w.id, w.user_id, w.account_id, w.to_addr, 
              COALESCE(w.amount_cents, ROUND(w.amount*100))::bigint AS amount_cents,
              COALESCE(w.fee_cents,    ROUND(w.fee_amount*100))::bigint AS fee_cents
         FROM withdrawals w
        WHERE w.network='tron' AND w.token='USDT'
          AND w.status='pending'
        ORDER BY w.created_at ASC
        LIMIT $1`, [N]
    );

    for (const w of pend) {
      const amtUSD = Number(w.amount_cents || 0) / 100;

      try {
        // check omnibus balance roughly (optional, you can call tronUsdtBalanceOf)
        // const omniBal = await tronUsdtBalanceOf(OMNIBUS_TRON_ADDR);
        // if (omniBal < amtUSD) { /* skip + log */ }

        const tx = await tronBroadcastUSDT({ to: w.to_addr, amountUSDT: amtUSD });
        await pool.query(
          `UPDATE withdrawals SET status='broadcasted', tx_hash=$1 WHERE id=$2`,
          [tx, w.id]
        );

        // email broadcasted
        const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id=$1', [w.user_id]);
        await sendMailSafe({
          to: u.email,
          subject: 'Withdrawal Broadcasted',
          html: EmailTpl.withdrawalBroadcasted({ amount: amtUSD, tx }),
        });
      } catch (e) {
        console.error('[withdraw-broadcast] id', w.id, e?.message || e);
        // Mark failed and refund total (amount + fee) to account balance
        const totalCents = Number(w.amount_cents || 0) + Number(w.fee_cents || 0);
        try {
          await withTx(async (c) => {
            await c.query(`UPDATE withdrawals SET status='failed' WHERE id=$1`, [w.id]);
            await c.query(`UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id=$2`,
              [totalCents, w.account_id]);
            const { rows: [u] } = await c.query('SELECT email FROM users WHERE id=$1', [w.user_id]);
            await sendMailSafe({
              to: u.email,
              subject: 'Withdrawal Failed',
              html: EmailTpl.withdrawalFailed({ amount: Number(w.amount_cents)/100, reason: e?.message }),
            });
          });
        } catch (e2) {
          console.error('[withdraw-refund-fail] id', w.id, e2?.message || e2);
        }
      }
    }
  } catch (e) {
    console.error('[withdraw-pending-scan] error:', e?.message || e);
  }

  // 2) Confirm broadcasted
  try {
    const { rows: bc } = await pool.query(
      `SELECT id, user_id, account_id, tx_hash,
              COALESCE(amount_cents, ROUND(amount*100))::bigint AS amount_cents
         FROM withdrawals
        WHERE network='tron' AND token='USDT'
          AND status='broadcasted'
        ORDER BY created_at ASC
        LIMIT 50`
    );

    for (const w of bc) {
      if (!w.tx_hash) continue;
      try {
        const res = await tronGetReceipt(w.tx_hash);
        if (!res.found) continue;                    // not yet in a block

        if (res.ok) {
          await pool.query(
            `UPDATE withdrawals SET status='confirmed' WHERE id=$1`, [w.id]
          );
          const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id=$1', [w.user_id]);
          await sendMailSafe({
            to: u.email,
            subject: 'Withdrawal Confirmed',
            html: EmailTpl.withdrawalConfirmed({ amount: Number(w.amount_cents)/100, tx: w.tx_hash }),
          });
        } else {
          // on-chain failure → refund amount+fee
          const { rows: f } = await pool.query(
            `SELECT COALESCE(fee_cents, ROUND(fee_amount*100))::bigint AS fee_cents, account_id
               FROM withdrawals WHERE id=$1`, [w.id]
          );
          const feeCents = Number(f?.[0]?.fee_cents || 0);
          const totalCents = Number(w.amount_cents || 0) + feeCents;

          await withTx(async (c) => {
            await c.query(`UPDATE withdrawals SET status='failed' WHERE id=$1`, [w.id]);
            await c.query(`UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id=$2`,
              [totalCents, w.account_id]);
            const { rows: [u] } = await c.query('SELECT email FROM users WHERE id=$1', [w.user_id]);
            await sendMailSafe({
              to: u.email,
              subject: 'Withdrawal Failed',
              html: EmailTpl.withdrawalFailed({ amount: Number(w.amount_cents)/100, reason: 'On-chain failure' }),
            });
          });
        }
      } catch (e) {
        console.error('[withdraw-confirm-scan] id', w.id, e?.message || e);
      }
    }
  } catch (e) {
    console.error('[withdraw-broadcasted-scan] error:', e?.message || e);
  }
}

// Run workers
setInterval(processWithdrawalsOnce, 30_000);



// === DEPOSITS: detect TRON USDT credits (poller) ===

// Deposit helpers
async function upsertDeposit(d) {
  const { user_id, account_id, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status } = d;
  try {
    await pool.query(
      `
      INSERT INTO deposits (user_id, account_id, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (tx_hash) DO UPDATE
      SET
        confirmations = GREATEST(deposits.confirmations, EXCLUDED.confirmations),
        status = CASE WHEN deposits.status = 'confirmed' THEN 'confirmed' ELSE EXCLUDED.status END
      `,
      [user_id, account_id || null, network, token, tx_hash, from_addr, to_addr, amount, confirmations, status]
    );
  } catch (e) {
    console.error('upsertDeposit error:', e);
  }
}




// return true only when we transition -> confirmed and add balance
async function confirmAndCredit(tx_hash) {
  return await withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM deposits WHERE tx_hash=$1 FOR UPDATE', [tx_hash]);
    if (!rows.length) return false;
    const d = rows[0];
    if (d.status === 'confirmed') return false;

    await c.query('UPDATE deposits SET status=$1 WHERE tx_hash=$2', ['confirmed', tx_hash]);

    // credit user + account (existing code)
    await c.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2',
                  [Number(d.amount), d.user_id]);
    if (d.account_id) {
      const cents = Math.round(Number(d.amount) * 100);
      await c.query('UPDATE accounts SET balance_cents = COALESCE(balance_cents,0) + $1 WHERE id=$2',
                    [cents, d.account_id]);
    }

    // email notify
    try {
      const { rows: [u] } = await c.query('SELECT email FROM users WHERE id=$1', [d.user_id]);
      await sendMailSafe({
        to: u.email,
        subject: 'Deposit Confirmed',
        html: EmailTpl.depositConfirmed({ amount: d.amount, tx: d.tx_hash }),
      });
    } catch (e) {
      console.error('[email] depositConfirmed:', e?.message || e);
    }

    return true;
  });
}




// Poll TronGrid for USDT TRC20 transfers into user deposit addresses.
// - Uses settings.tron_since_ts (ms) as a low‑water mark
// - Never downgrades confirmed rows (requires your updated upsertDeposit)
// - Only logs when a credit actually happened
// - Advances cursor by +1ms to avoid boundary repeats
async function pollTron() {
  try {
    const sinceTs = Number(await getSetting('tron_since_ts')) || 0;
    const headers = TRON_HEADERS || {};
    let maxTs = sinceTs;

    // All TRON USDT deposit addresses we manage
    const { rows: wallets } = await pool.query(
      "SELECT user_id, address, account_id FROM wallets WHERE network='tron' AND token='USDT'"
    );
    

    if (!wallets.length) {
      await setSetting('tron_since_ts', sinceTs || Date.now());
      return;
    }

    for (const w of wallets) {
      const addr = w.address;

      // Transfers TO this address for our USDT contract
      const u = new URL(`${TRON_FULLHOST}/v1/accounts/${addr}/transactions/trc20`);
      u.searchParams.set('only_to', 'true');
      u.searchParams.set('limit', '200');
      u.searchParams.set('contract_address', USDT_TRON_CONTRACT);
      if (sinceTs) u.searchParams.set('min_timestamp', String(sinceTs));

      let resp;
      try {
        resp = await fetch(u.toString(), { headers });
      } catch (netErr) {
        console.error('[pollTron] fetch error', addr, netErr?.message || netErr);
        continue;
      }

      // 404 is normal for empty/new accounts
      if (resp.status === 404) continue;
      if (!resp.ok) {
        console.error('[pollTron] http', resp.status, addr);
        continue;
      }

      let json;
      try {
        json = await resp.json();
      } catch (e) {
        console.error('[pollTron] json parse failed for', addr, e?.message || e);
        continue;
      }

      const txs = json?.data || [];
      if (!txs.length) continue;

      for (const t of txs) {
        const ts = Number(t.block_timestamp || 0);
        if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;

        const tx = t.transaction_id;
        const to = t.to || null;
        const from = t.from || null;
        if (!tx || to !== addr) continue;

        // decimals pref: token_info.decimals → t.decimals → 6
        const decimals = Number((t.token_info && t.token_info.decimals) ?? t.decimals ?? 6);
        const raw = Number(t.value);
        if (!Number.isFinite(raw) || raw <= 0) continue;

        const amount = raw / Math.pow(10, decimals);

        // 1) Upsert (non‑downgrading)
        await upsertDeposit({
          user_id: w.user_id,
          account_id: w.account_id || null,   // <-- attach if this wallet belongs to an account
          network: 'tron',
          token: 'USDT',
          tx_hash: tx,
          from_addr: from,
          to_addr: to,
          amount,
          confirmations: TRON_REQUIRED_CONFS,
          status: 'pending'
        });
        

        // 2) Confirm & credit ONCE; log only if it actually credited
        let didCredit = false;
        try {
          didCredit = await confirmAndCredit(tx); // <- your confirm returns boolean now
        } catch (e) {
          console.error('confirmAndCredit error', tx, e?.message || e);
        }
        if (didCredit) {
          console.log(`[credit] +${amount} USDT -> user ${w.user_id} addr ${to} tx ${tx}`);
        }
      }
    }

    // Advance by +1ms to avoid boundary re-fetch
    await setSetting('tron_since_ts', maxTs ? (maxTs + 1) : Date.now());
  } catch (e) {
    console.error('pollTron error:', e?.message || e);
  }
}



function genAccountCode(userId, seq){
  // Matches your UI style: "GV{150000 + userId}-{NN}"
  const base = 150000 + Number(userId || 0);
  return `GV${base}-${String(seq).padStart(2,'0')}`;
}

/** Generate a TRON deposit address for an account and return { address, privEnc } */
async function createTronAddressForAccount() {
  let acct;
  try {
    acct = await tronWeb.createAccount();
  } catch (e) {
    const gen = TronWeb?.utils?.accounts?.generateAccount?.();
    if (!gen?.privateKey) throw new Error('Failed to generate TRON account');
    const base58 = tronWeb.address.fromPrivateKey(gen.privateKey);
    acct = { privateKey: gen.privateKey, address: { base58, hex: tronWeb.address.toHex(base58) } };
  }
  const address = acct.address.base58;
  const privEnc = aesEncrypt(acct.privateKey);
  return { address, privEnc };
}




// Poller (20s)
setInterval(pollTron, 20_000);

// Manual refresh (single definition)
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
        WHERE network='tron' AND token='USDT' AND sweep_enabled = true`
    );      

    for (const w of tronWallets) {
      const addr = w.address;
      if (addr === OMNIBUS_TRON_ADDR) continue;

      // 1) Must have a stored key
      if (!w.priv_enc) {
        // log once per wallet id (optional: add a 'last_sweep_error_at' column to throttle)
        console.error('sweep skip: no priv_enc for', { wallet_id: w.id, addr });
        continue;
      }

      // 2) Decrypt & verify key controls the address
      let perUserPrivHex, derived;
      try {
        perUserPrivHex = aesDecrypt(w.priv_enc);
        derived = tronWeb.address.fromPrivateKey(perUserPrivHex); // base58
      } catch (e) {
        console.error('sweep skip: decrypt/derive failed', { wallet_id: w.id, addr, err: e?.message || e });
        continue;
      }
      if (derived !== addr) {
        console.error('sweep skip: priv key/address mismatch', { wallet_id: w.id, addr, derived });
        continue; // do not attempt to sign with a mismatched key
      }

      // 3) Check balance
      let bal = 0;
      try {
        bal = await tronUsdtBalanceOf(addr);
      } catch (e) {
        console.error('Tron balanceOf failed for', addr, e?.message || e);
        continue;
      }
      if (!bal || bal < SWEEP_DUST_THRESHOLD) continue;

      // 4) Build & send transfer as the deposit address
      try {
        tronWeb.setAddress(addr); // set owner/sender context

        const amountSun = BigInt(Math.floor(bal * 1e6)).toString();
        const tx = await contract
          .transfer(OMNIBUS_TRON_ADDR, amountSun)
          .send({ privateKey: perUserPrivHex }); // signs as 'addr'

        await pool.query(
          `UPDATE deposits
              SET swept = true, sweep_tx_hash = $1
            WHERE to_addr = $2 AND network='tron' AND token='USDT'`,
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


app.post('/admin/wallet/:address/sweep/:action', adminAuth, async (req, res) => {
  const { address, action } = req.params;
  const enabled = action === 'enable';
  await pool.query(
    `UPDATE wallets SET sweep_enabled=$1 WHERE network='tron' AND token='USDT' AND address=$2`,
    [enabled, address]
  );
  res.json({ address, sweep_enabled: enabled });
});


app.post('/admin/sweep-once', adminAuth, async (_req, res) => {
  await sweepTronOnce();
  res.json({ ok: true });
});





// Admin emails: comma-separated in env: ADMIN_EMAILS="you@domain.com,other@x.com"
const ADMINS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function adminAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing token' });
  try {
    const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    if (!decoded?.email || !ADMINS.includes(String(decoded.email).toLowerCase())) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(403).json({ message: 'Invalid token' });
  }
}


//============================================================



// POST /accounts  { tier: 'standard' | 'pro' | 'elite' }
app.post('/accounts', authenticate, async (req, res) => {
  const { tier } = req.body || {};
  if (!tier) return res.status(400).json({ message: 'Tier is required' });

  const client = await pool.connect();
  try {
    const { rows: [t] } = await client.query(
      `SELECT id, display_name, return_percent, min_deposit_cents, fee_cents
         FROM account_tiers WHERE code=$1`, [tier]
    );
    if (!t) return res.status(400).json({ message: 'Invalid tier' });

    // per-user sequence = count+1
    const { rows: [cnt] } = await client.query(
      `SELECT COUNT(*)::int AS c FROM accounts WHERE user_id=$1`,
      [req.user.id]
    );
    const seq = (cnt?.c || 0) + 1;
    const account_code = genAccountCode(req.user.id, seq);

    const { rows: [acc] } = await client.query(`
      INSERT INTO accounts (user_id, tier_id, account_code)
      VALUES ($1,$2,$3)
      RETURNING id, account_code, status, balance_cents, profit_cents, created_at
    `, [req.user.id, t.id, account_code]);

    res.status(201).json({
      id: acc.id,
      account_code: acc.account_code,
      status: acc.status,
      balance_cents: acc.balance_cents,
      profit_cents: acc.profit_cents,
      created_at: acc.created_at,
      // include tier fields the frontend uses
      tier,
      display_name: t.display_name,
      return_percent: t.return_percent,
      min_deposit_cents: t.min_deposit_cents
    });
  } catch (e) {
    console.error('POST /accounts', e);
    if (String(e.code) === '23505') {
      return res.status(409).json({ message: 'Account code conflict, retry' });
    }
    res.status(500).json({ message: 'Failed to create account' });
  } finally {
    client.release();
  }
});


// GET /accounts
app.get('/accounts', authenticate, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.id, a.account_code, a.status, a.balance_cents, a.profit_cents, a.created_at,
           at.code AS tier, at.display_name, at.return_percent, at.min_deposit_cents
    FROM accounts a
    JOIN account_tiers at ON at.id = a.tier_id
    WHERE a.user_id = $1
    ORDER BY a.created_at ASC
  `, [req.user.id]);
  res.json(rows);
});


// POST /accounts/:id/wallet/assign
// Constants for the only crypto we support
const WALLET_ASSET = 'USDT-TRC20';          // store once, reuse everywhere

// Optional: very simple TRON address shape check (not full validation, just format)
const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

async function getOrCreateUserTronWallet(pool, userId, accountId) {
  // Try existing first
  const { rows: existing } = await pool.query(
    `SELECT id, user_id, account_id, network, token, address, priv_enc, sweep_enabled
       FROM wallets
      WHERE user_id=$1 AND network='tron' AND token='USDT'`,
    [userId]
  );
  if (existing.length && existing[0].address) {
    const w = existing[0];
    // ensure account_id is filled if provided now
    if (!w.account_id && accountId) {
      await pool.query(`UPDATE wallets SET account_id=$1 WHERE id=$2`, [accountId, w.id]);
      w.account_id = accountId;
    }
    return w;
  }

  // Generate a new wallet (address + encrypted key)
  const { address, privEnc } = await generateTronWalletWithEncryptedKey();

  try {
    const { rows: [wallet] } = await pool.query(`
      INSERT INTO wallets (user_id, account_id, network, token, address, priv_enc, sweep_enabled)
      VALUES ($1, $2, 'tron', 'USDT', $3, $4, true)
      ON CONFLICT (user_id) DO UPDATE
         SET account_id    = COALESCE(EXCLUDED.account_id, wallets.account_id),
             address       = EXCLUDED.address,
             priv_enc      = COALESCE(wallets.priv_enc, EXCLUDED.priv_enc),
             sweep_enabled = EXCLUDED.sweep_enabled
      RETURNING id, user_id, account_id, network, token, address, priv_enc, sweep_enabled
    `, [userId, accountId || null, address, privEnc]);

    return wallet;
  } catch (e) {
    // If another request created it first, just load and return
    if (e?.code === '23505') {
      const { rows } = await pool.query(
        `SELECT id, user_id, account_id, network, token, address, priv_enc, sweep_enabled
           FROM wallets
          WHERE user_id=$1 AND network='tron' AND token='USDT'`,
        [userId]
      );
      const w = rows[0];
      if (w && accountId && !w.account_id) {
        await pool.query(`UPDATE wallets SET account_id=$1 WHERE id=$2`, [accountId, w.id]);
        w.account_id = accountId;
      }
      return w;
    }
    throw e;
  }
}


async function generateTronWalletWithEncryptedKey() {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const rnd = (len) => {
    const buf = crypto.randomBytes(len);
    let s = '';
    for (let i = 0; i < buf.length; i++) s += alphabet[buf[i] % 58];
    return s;
  };
  const address = 'T' + rnd(33);
  const privEnc = 'enc:' + rnd(64);
  return { address, privEnc };
}




// ---- Route: assign (or return) user TRC20 wallet for a specific account
app.post('/accounts/:id/wallet/assign', authenticate, async (req, res) => {
  try {
    const accountId = Number(req.params.id);
    const userId = Number(req.user.id);
    if (!accountId) return res.status(400).json({ message: 'Invalid account id' });

    // (optional) verify the account belongs to the user
    const acc = await pool.query(`SELECT id FROM accounts WHERE id = $1 AND user_id = $2`, [accountId, userId]);
    if (!acc.rows[0]) return res.status(404).json({ message: 'Account not found' });

    const wallet = await getOrCreateUserTronWallet(pool, userId, accountId);

    return res.status(200).json({
      account_id: accountId,
      asset: WALLET_ASSET,
      network: 'tron',
      token: 'USDT',
      address: wallet.address
    });
  } catch (err) {
    console.error('assign wallet error:', err);  // <-- keep so we see the real cause in Heroku logs
    return res.status(500).json({ message: 'Failed to assign wallet' });
  }
});





// GET /accounts/:id
app.get('/accounts/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { rows: [row] } = await pool.query(`
    SELECT a.id, a.account_code, a.status, a.balance_cents, a.profit_cents, a.created_at,
           at.code AS tier, at.display_name, at.return_percent, at.min_deposit_cents
    FROM accounts a
    JOIN account_tiers at ON at.id = a.tier_id
    WHERE a.id=$1 AND a.user_id=$2
  `, [id, req.user.id]);
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json(row);
});

// GET /accounts/:id/deposits
app.get('/accounts/:id/deposits', authenticate, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`
    SELECT created_at,
           (amount * 100)::bigint AS amount_cents,
           token AS currency,
           status,
           tx_hash
      FROM deposits
     WHERE user_id = $1
       AND account_id = $2
     ORDER BY created_at DESC
  `, [req.user.id, id]);
  res.json(rows);
});


// GET /accounts/:id/withdrawals
app.get('/accounts/:id/withdrawals', authenticate, async (req, res) => {
  const userId = req.user.id;
  const accountId = Number(req.params.id);
  try {
    const { rows: ok } = await pool.query(
      `SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2`, [accountId, userId]
    );
    if (!ok.length) return res.status(404).json([]);

    const { rows } = await pool.query(
      `SELECT id, user_id, account_id, status, created_at,
              COALESCE(amount_cents, ROUND(amount*100))::bigint AS amount_cents,
              COALESCE(fee_cents, ROUND(fee_amount*100))::bigint AS fee_cents,
              GREATEST( COALESCE(amount_cents, ROUND(amount*100))::bigint - 
                        COALESCE(fee_cents, ROUND(fee_amount*100))::bigint, 0) AS net_cents
         FROM withdrawals
        WHERE account_id=$1
        ORDER BY created_at DESC
        LIMIT 200`,
      [accountId]
    );
    res.json(rows);
  } catch (e) {
    console.error('list withdrawals error:', e);
    res.status(500).json([]);
  }
});


// === Unified Transactions: deposits + withdrawals ===
app.get('/accounts/:id/transactions', authenticate, async (req, res) => {
  const userId = req.user.id;
  const accId  = Number(req.params.id);
  if (!accId) return res.status(400).json({ message: 'Invalid account id' });

  try {
    const { rows: accountRows } = await pool.query(
      `SELECT id FROM accounts WHERE id=$1 AND user_id=$2`,
      [accId, userId]
    );
    if (!accountRows.length) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Fetch deposits
    const { rows: deposits } = await pool.query(
      `SELECT id,
              created_at,
              (amount * 100)::bigint AS amount_cents,
              token AS currency,
              status
        FROM deposits
        WHERE account_id = $1
        ORDER BY created_at DESC`,
      [accId]
    );

    // Fetch withdrawals
    const { rows: withdrawals } = await pool.query(
      `SELECT id,
              created_at,
              COALESCE(amount_cents, ROUND(amount * 100))::bigint AS amount_cents,
              COALESCE(fee_cents,    ROUND(fee_amount * 100))::bigint AS fee_cents,
              COALESCE(address, to_addr) AS address,
              status
        FROM withdrawals
        WHERE account_id = $1
        ORDER BY created_at DESC`,
      [accId]
    );


    // Normalize to a common schema
    const txs = [];

    for (const d of deposits) {
      txs.push({
        type: 'deposit',
        id: d.id,
        created_at: d.created_at,
        amount_cents: Number(d.amount_cents || 0),
        fee_cents: 0,
        net_cents: Number(d.amount_cents || 0),
        currency: (d.currency || 'USDT').toUpperCase(),
        status: d.status || 'confirmed'
      });
    }

    for (const w of withdrawals) {
      txs.push({
        type: 'withdrawal',
        id: w.id,
        created_at: w.created_at,
        amount_cents: Number(w.amount_cents || 0),
        fee_cents: Number(w.fee_cents || 0),
        net_cents: Number(w.amount_cents || 0) - Number(w.fee_cents || 0),
        currency: 'USDT',
        address: w.address,
        status: w.status || 'pending'
      });
    }

    // Sort newest first
    txs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.json(txs);
  } catch (err) {
    console.error('transactions error:', err);
    return res.status(500).json({ message: 'Failed to load transactions' });
  }
});





 app.post('/dev/topup', adminAuth, async (req, res) => {
     if (!process.env.TEMP_ALLOW_DEV) return res.status(404).json({ message: 'not found' });
     const userId  = req.user.id;
     const dollars = Math.max(1, Number(req.body.amount || 0));
     const { rows } = await pool.query(
       'SELECT id FROM accounts WHERE user_id=$1 ORDER BY created_at ASC LIMIT 1',
       [userId]
     );
     if (!rows[0]) return res.status(400).json({ message: 'no account' });
     await pool.query('UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id=$2',
       [Math.round(dollars * 100), rows[0].id]);
     return res.json({ ok: true, credited: dollars });
   });
  




// env:
// LEDGER_CURRENCY=USD
// FX_NGN_PER_USD=1500   // example; set the real rate via env/cron

const LEDGER_CURRENCY = (process.env.LEDGER_CURRENCY || 'USD').toUpperCase();
const FX_NGN_PER_USD = Number(process.env.FX_NGN_PER_USD || '1500');

function convertToLedger(amountMajor, fromCur, toCur) {
  fromCur = (fromCur || 'USD').toUpperCase();
  toCur = (toCur || 'USD').toUpperCase();
  if (fromCur === toCur) return amountMajor;

  if (fromCur === 'NGN' && toCur === 'USD') {
    if (!FX_NGN_PER_USD || FX_NGN_PER_USD <= 0) throw new Error('Missing FX_NGN_PER_USD');
    return amountMajor / FX_NGN_PER_USD;
  }

  // Add more pairs as needed
  throw new Error(`No FX path ${fromCur} -> ${toCur}`);
}


// after creating checkout, you already have pay.id
async function pollPayment(id, { tries = 12, intervalMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`/payments/${id}/status`, { headers: { Authorization: `Bearer ${token}` }});
    const j = await r.json();
    if (j.status === 'succeeded') return j;
    if (['failed','canceled'].includes(j.status)) throw new Error(j.status);
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error('timeout');
}




async function finalizeFiatPaymentByRef(providerRef, mappedStatus, providerPayload) {
  return await withTx(async (c) => {
    const { rows: [p] } = await c.query(
      `SELECT * FROM payments WHERE provider_ref=$1 FOR UPDATE`,
      [providerRef]
    );
    if (!p) return false;
    if (['succeeded','failed','canceled'].includes(p.status)) return true;

    await c.query(
      `UPDATE payments
          SET status=$1, meta=$2::jsonb, updated_at=now()
        WHERE id=$3`,
      [mappedStatus, JSON.stringify(providerPayload || {}), p.id]
    );

    if (mappedStatus !== 'succeeded') return true;

    const srcCurrency = (p.currency || 'USD').toUpperCase();
    const srcMajor = Number(p.amount_cents || 0) / 100; // amount in src currency (e.g., NGN)
    const ledgerMajor = convertToLedger(srcMajor, srcCurrency, LEDGER_CURRENCY);
    const ledgerCents = Math.round(ledgerMajor * 100);

    // Credit user + account in ledger currency (USD)
    await c.query(`UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE id=$2`,
      [ledgerMajor, p.user_id]);

    if (p.account_id) {
      await c.query(`UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id=$2`,
        [ledgerCents, p.account_id]);
    }

    // Record deposit with ledger currency, but keep original in the row’s meta via payments.meta
    await c.query(
      `INSERT INTO deposits (user_id, account_id, network, token, tx_hash, amount, status)
       VALUES ($1,$2,'fiat',$3,$4,$5,'confirmed')`,
      [p.user_id, p.account_id, LEDGER_CURRENCY, providerRef, ledgerMajor]
    );

    // (Optional) email receipt can mention both amounts:
    try {
      const { rows: [user] } = await c.query(`SELECT email FROM users WHERE id=$1`, [p.user_id]);
      if (user?.email) {
        await sgMail.send({
          to: user.email,
          from: process.env.FROM_EMAIL || 'noreply@glorivest.com',
          subject: 'Deposit received',
          html: `<p>We’ve received <b>${srcCurrency} ${srcMajor.toLocaleString()}</b> (credited as <b>${LEDGER_CURRENCY} ${ledgerMajor.toFixed(2)}</b>).</p><p>Ref: ${providerRef}</p>`
        });
      }
    } catch (e) {
      console.error('send receipt email failed:', e?.message || e);
    }

    return true;
  });
}


const LEDGER_CCY = (process.env.LEDGER_CURRENCY || 'USD').toUpperCase();

function toLedgerCents({ amountCents, currency }) {
  const cur = (currency || LEDGER_CCY).toUpperCase();

  if (cur === LEDGER_CCY) {
    return { ledgerCents: amountCents, fx_rate: 1, fx_base: cur, fx_quote: LEDGER_CCY };
  }

  // NGN -> USD path
  if (cur === 'NGN' && LEDGER_CCY === 'USD') {
    const rate = Number(process.env.FX_NGNUSD || 0);
    if (!rate) throw new Error('FX_NGNUSD not set');
    // amountCents is NGN*100. Convert to USD dollars, then to USD cents.
    const usdCents = Math.round((amountCents / 100) * rate * 100);
    return { ledgerCents: usdCents, fx_rate: rate, fx_base: 'NGN', fx_quote: 'USD' };
  }

  throw new Error(`No FX path for ${cur}->${LEDGER_CCY}`);
}





// ===== Server Init =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Booting...');
  console.log(`Server running on port ${PORT}`);
});
