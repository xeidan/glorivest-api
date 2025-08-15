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



// // ======= PAYMENTS =======
// // ===== Create CRYPTO charge (Coinbase Commerce) =====
// app.post('/deposits/crypto/create', authenticate, async (req, res) => {
//   try {
//     const { amount, currency = 'USD', idempotency_key } = req.body; // display currency
//     if (!amount || Number(amount) <= 0) return res.status(400).json({ message: 'Invalid amount' });

//     const amount_cents = Math.round(Number(amount) * 100);

//     // Create DB row first
//     const client = await pool.connect();
//     let dep;
//     try {
//       await client.query('BEGIN');
//       const { rows: [row] } = await client.query(
//         `INSERT INTO deposits (user_id, provider, type, amount_cents, currency, status, idempotency_key)
//          VALUES ($1,'coinbase','crypto',$2,$3,'pending',$4) RETURNING *`,
//         [req.user.id, amount_cents, currency.toLowerCase(), idempotency_key || null]
//       );
//       dep = row;
//       await client.query('COMMIT');
//     } catch (e) { await client.query('ROLLBACK'); throw e; }
//     finally { client.release(); }

//     // Coinbase hosted charge
//     const charge = await Charge.create({
//       name: 'Glorivest Deposit',
//       description: `Deposit ${amount} ${currency.toUpperCase()}`,
//       pricing_type: 'fixed_price',
//       local_price: { amount: String(amount), currency: currency.toUpperCase() },
//       metadata: { deposit_id: dep.id, user_id: req.user.id },
//       redirect_url: `${process.env.APP_BASE_URL}/dashboard.html#deposit-success`,
//       cancel_url:   `${process.env.APP_BASE_URL}/dashboard.html#deposit-cancel`
//     });

//     await pool.query(`UPDATE deposits SET provider_ref = $1, meta = meta || $2::jsonb WHERE id = $3`,
//       [charge.id, JSON.stringify({ hosted_url: charge.hosted_url }), dep.id]);

//     res.json({ hosted_url: charge.hosted_url, charge_id: charge.id, deposit_id: dep.id });
//   } catch (err) {
//     console.error('create crypto charge error:', err);
//     res.status(500).json({ message: 'Failed to create crypto deposit' });
//   }
// });

// // ===== Coinbase webhook =====
// async function coinbaseWebhookHandler(req, res) {
//   try {
//     const sig = req.headers['x-cc-webhook-signature'];
//     const raw = req.body; // already raw
//     const event = coinbase.Webhook.verifyEventBody(
//       raw,
//       sig,
//       process.env.COINBASE_COMMERCE_WEBHOOK_SECRET
//     );

//     if (event.type === 'charge:confirmed' || event.type === 'charge:resolved') {
//       const charge = event.data;
//       const providerRef = charge.id;
//       const { rows } = await pool.query(`SELECT * FROM deposits WHERE provider_ref = $1`, [providerRef]);
//       if (!rows.length) return res.json({ ok: true });

//       const dep = rows[0];
//       if (dep.status === 'confirmed') return res.json({ ok: true });

//       const client = await pool.connect();
//       try {
//         await client.query('BEGIN');
//         await client.query(`UPDATE deposits SET status='confirmed' WHERE id = $1`, [dep.id]);
//         await creditUserBalanceTx(client, dep.user_id, dep.amount_cents);
//         await client.query('COMMIT');
//       } catch (e) { await client.query('ROLLBACK'); throw e; }
//       finally { client.release(); }

//       return res.json({ ok: true });
//     }

//     if (event.type === 'charge:failed' || event.type === 'charge:delayed') {
//       const charge = event.data;
//       await pool.query(`UPDATE deposits SET status='failed' WHERE provider_ref = $1`, [charge.id]);
//     }

//     res.json({ received: true });
//   } catch (err) {
//     console.error('Coinbase wh error:', err);
//     res.status(400).send('Bad webhook');
//   }
// }






// ===== Server Init =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Booting...');
  console.log(`Server running on port ${PORT}`);
});
