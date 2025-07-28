require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');

const app = express();
app.set('trust proxy', 1);

// ===== CORS CONFIG =====
app.options('*', cors()); // 👈 respond to preflight

const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://localhost:5502',
  'http://127.0.0.1:5502',
  'https://www.glorivest.com',
  'https://xeidan.github.io',
  'https://glorivest.github.io',
  'https://glorivest.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS BLOCKED ORIGIN: ${origin}`);
      callback(new Error('CORS not allowed for this origin: ' + origin));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());
app.use(morgan('combined'));

//rate limiter
// ==== RATE LIMITERS ====
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many attempts. Please try again after 15 minutes.'
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'OTP request limit reached. Try again later.'
});

// Auth routes
app.post('/login', authLimiter);
app.post('/signup', authLimiter);
app.post('/verify', otpLimiter);
app.post('/resend-verification', otpLimiter);
app.post('/request-reset', otpLimiter);
app.post('/verify-reset', otpLimiter);


// ===== DATABASE CONFIG =====
let pool;
if (process.env.DATABASE_URL) {
  const config = parse(process.env.DATABASE_URL);
  config.ssl = { rejectUnauthorized: false };
  pool = new Pool(config);
} else {
  pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
  });
}

// ===== SENDGRID CONFIG =====
// ===== SENDGRID CONFIG (inside server.js) =====
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function sendOtpEmail(email, otp) {
  const msg = {
    to: email,
    from: { email: process.env.EMAIL_USER }, // ✅ fixed
    subject: 'Your OTP Code',
    text: `Your OTP is: ${otp}`,
  };
  return sgMail.send(msg).catch(error => {
    console.error("SENDGRID RAW ERROR:", error.response ? error.response.body : error.message);
    throw error;
  });
}

function sendReferralNotification(inviterEmail, newUserEmail) {
  const msg = {
    to: inviterEmail,
    from: { email: process.env.EMAIL_USER }, // ✅ fixed
    subject: '🎉 You Just Got a Referral!',
    text: `Hi there,\n\n${newUserEmail} just signed up using your referral code.\n\nOnce they deposit, you'll receive 5% of their deposit amount as a reward.\n\nKeep sharing and earning!\n\n– The Glorivest Team`
  };

  return sgMail.send(msg).catch(error => {
    console.error("Referral email send error:", error.response ? error.response.body : error.message);
    // Do not throw here to avoid interrupting signup flow
  });
}



// ====== RAVE ID GENERATOR ======
async function generateRaveId(userId) {
  const raveId = 'RAVE' + String(userId).padStart(6, '0');
  await pool.query('UPDATE users SET rave_id = $1 WHERE id = $2', [raveId, userId]);
}

//======BOT FUNCTION ======
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Missing token' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}


// ====== ROUTES ======
app.get('/ping', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send('pong');
});

app.get('/', (req, res) => {
  res.send('glorivest backend is live');
});

/// me route
app.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.sendStatus(401);

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) return res.sendStatus(404);
    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      rave_id: user.rave_id,
      reward_balance: user.reward_balance,
      referral_earnings: user.referral_earnings,
      referral_code: user.referral_code,
      total_referrals: user.total_referrals,
      bot_started_at: user.bot_started_at, 
      bot_active: user.bot_active
    });    
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

//signup
app.post('/signup', async (req, res) => {
  const { email, password, referral_code } = req.body;
  const client = await pool.connect();

  try {
    // Check if user already exists
    const existing = await client.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Prepare referred_by (inviter's ID)
    let referred_by = null;
    let inviterEmail = null;

    if (referral_code) {
      const refUser = await client.query('SELECT id, email FROM users WHERE referral_code = $1', [referral_code]);
      if (refUser.rows.length > 0) {
        referred_by = refUser.rows[0].id;
        inviterEmail = refUser.rows[0].email;
      }
    }

    // Hash password + generate OTP
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const newReferralCode = `rave${Math.floor(100000 + Math.random() * 900000)}`;

    // Begin transaction
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO users (email, password, referral_code, referred_by, otp)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, is_verified`,
      [email, hashedPassword, newReferralCode, referred_by, otp]
    );

    const user = result.rows[0];

    // Generate rave_id
    await generateRaveId(user.id);

    // Send OTP to user
    await sendOtpEmail(email, otp);

    // Notify inviter by email
    if (inviterEmail) {
      await sendReferralNotification(inviterEmail, email);
    }

    await client.query('COMMIT');

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'User created. Check email for OTP.',
      token,
      is_verified: user.is_verified
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Signup error:', error.message || error);
    res.status(500).json({ message: 'Error creating user' });
  } finally {
    client.release();
  }
});


//verify
app.post('/verify', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND otp = $2', [email, otp]);
    if (result.rows.length === 0) return res.status(403).json({ message: 'Invalid OTP' });
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [email]);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Error verifying email' });
  }
});



//resend verification
app.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });

    const user = result.rows[0];
    if (user.is_verified) return res.json({ message: "Email already verified" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('UPDATE users SET otp = $1 WHERE email = $2', [otp, email]);
    await sendOtpEmail(email, otp);
    res.json({ message: "OTP resent successfully" });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ message: "Error resending OTP" });
  }
});

app.get('/test-cors', (req, res) => {
  res.json({ message: 'CORS working' });
});


//login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  console.log("Login attempt:", email);

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(403).json({ message: 'Invalid credentials' });

    const user = result.rows[0];
    console.log("User found:", !!user);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(403).json({ message: 'Invalid credentials' });

    if (!user.is_verified) {
      return res.status(403).json({ message: 'Email not verified. Please verify to continue.' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        rave_id: user.rave_id,
        reward_balance: user.reward_balance,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});


//request reset for password
app.post('/request-reset', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('UPDATE users SET otp = $1, reset_otp_verified = false WHERE email = $2', [otp, email]);
    await sendOtpEmail(email, otp);
    res.json({ message: 'Reset OTP sent' });
  } catch (error) {
    console.error('Request reset error:', error);
    res.status(500).json({ message: 'Error requesting reset' });
  }
});


//verify password
app.post('/verify-reset', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND otp = $2', [email, otp]);
    if (result.rows.length === 0) return res.status(403).json({ message: 'Invalid OTP' });

    await pool.query('UPDATE users SET reset_otp_verified = true WHERE email = $1', [email]);
    res.json({ message: 'Reset OTP verified' });
  } catch (error) {
    console.error('Verify reset error:', error);
    res.status(500).json({ message: 'Error verifying OTP' });
  }
});


//reset password
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND reset_otp_verified = true', [email]);
    if (result.rows.length === 0) return res.status(403).json({ message: 'OTP not verified' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, reset_otp_verified = false WHERE email = $2', [hashed, email]);
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});


//defining authenticateToken
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Start Bot
app.post("/bot/start", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if bot is already active
    const { rows } = await pool.query(
      "SELECT bot_active FROM users WHERE id = $1",
      [userId]
    );

    const isActive = rows[0]?.bot_active;
    if (isActive) {
      return res.status(200).json({ message: "Bot already running" });
    }

    // Start the bot
    await pool.query(
      "UPDATE users SET bot_active = true, bot_started_at = NOW() WHERE id = $1",
      [userId]
    );

    return res.status(200).json({ message: "Bot started successfully" });
  } catch (err) {
    console.error("Error in /bot/start:", err.message);
    return res.status(500).json({ message: "Failed to start bot" });
  }
});





// Stop Bot
app.post("/bot/stop", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "UPDATE users SET bot_active = false WHERE id = $1 RETURNING *",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Bot stopped" });
  } catch (err) {
    console.error("Error stopping bot:", err);
    res.status(500).json({ message: "Server error" });
  }
});



//referral stats
app.get('/referral/stats', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const referrals = await pool.query(
      'SELECT COUNT(*) FROM users WHERE referred_by = $1',
      [userId]
    );

    const earnings = await pool.query(
      'SELECT referral_earnings FROM users WHERE id = $1',
      [userId]
    );

    const totalReferrals = parseInt(referrals.rows[0].count || 0);
    const totalEarnings = earnings.rows[0]?.referral_earnings
      ? parseFloat(earnings.rows[0].referral_earnings)
      : 0;

    res.json({ totalReferrals, totalEarnings });

  } catch (err) {
    console.error('Referral stats error:', err);
    res.status(500).json({ message: 'Failed to fetch referral stats' });
  }
});


// referral leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT email, rave_id, reward_balance, referral_earnings AS referral_earnings
      FROM users
      ORDER BY reward_balance DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Leaderboard error:", err.message, err.stack);
    res.status(500).json({ message: "Failed to load leaderboard" });
  }
});



//positions
app.get("/positions/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM positions WHERE user_id = $1", [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching positions:", err);
    res.status(500).json({ message: "Failed to load positions" });
  }
});




//deposit
app.post('/deposit', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update user's balance
    await client.query(`
      UPDATE users SET balance = balance + $1 WHERE id = $2
    `, [amount, userId]);

    // 2. Check if user is referred and not yet rewarded
    const { rows } = await client.query(`
      SELECT referred_by, has_rewarded_inviter FROM users WHERE id = $1
    `, [userId]);

    const { referred_by, has_rewarded_inviter } = rows[0];

    if (referred_by && !has_rewarded_inviter) {
      const reward = parseFloat(amount) * 0.05;

      await client.query(`
        UPDATE users SET referral_earnings = referral_earnings + $1 WHERE id = $2
      `, [reward, referred_by]);

      await client.query(`
        UPDATE users SET has_rewarded_inviter = true WHERE id = $1
      `, [userId]);
    }

    await client.query('COMMIT');
    res.json({ message: "Deposit successful." });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Deposit error:", err);
    res.status(500).json({ message: "Deposit failed." });
  } finally {
    client.release();
  }
});

//account
app.get('/account/me', authenticate, async (req, res) => {
  const { id } = req.user;

  try {
    const { rows } = await pool.query(
      'SELECT email, rave_id, balance, reward_balance, bot_started_at FROM users WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    // Safely parse balances
    const available = parseFloat(user.balance || 0);
    const reward = parseFloat(user.reward_balance || 0);

    // Profit logic
    let profit = 0;
    if (user.bot_started_at) {
      const now = new Date();
      const started = new Date(user.bot_started_at);
      const msElapsed = now - started;
      const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);

      if (daysElapsed >= 30) {
        profit = 0.2 * (available + reward); // 20% profit after 30 days
      }
    }

    const total_balance = available + reward + profit;

    res.json({
      email: user.email,
      rave_id: user.rave_id,
      balance: available,
      reward_balance: reward,
      total_balance: total_balance
    });

  } catch (err) {
    console.error("Account route error:", err);
    res.status(500).json({ message: "Failed to load account data" });
  }
});


//withdrawals
app.post('/withdraw', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT balance, reward_balance, bot_started_at, eligible_for_withdrawal
      FROM users WHERE id = $1
    `, [userId]);

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const { balance, reward_balance, bot_started_at, eligible_for_withdrawal } = rows[0];

    const base = parseFloat(balance || 0);
    const bonus = parseFloat(reward_balance || 0);

    let profit = 0;
    let totalAvailable = base + bonus;

    if (eligible_for_withdrawal && bot_started_at) {
      const started = new Date(bot_started_at);
      const now = new Date();
      const days = (now - started) / (1000 * 60 * 60 * 24);
      if (days >= 30) {
        profit = 0.2 * (base + bonus);
        totalAvailable += profit;
      }
    }

    if (amount > totalAvailable) {
      return res.status(400).json({ message: 'Withdrawal exceeds available balance' });
    }

    // Deduct in this order: profit → reward_balance → balance
    let remaining = amount;

    if (profit > 0 && remaining > 0) {
      const usedProfit = Math.min(profit, remaining);
      profit -= usedProfit;
      remaining -= usedProfit;
    }

    if (bonus > 0 && remaining > 0) {
      const usedReward = Math.min(bonus, remaining);
      await client.query(`UPDATE users SET reward_balance = reward_balance - $1 WHERE id = $2`, [usedReward, userId]);
      remaining -= usedReward;
    }

    if (base > 0 && remaining > 0) {
      await client.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [remaining, userId]);
    }

    // Log the withdrawal
    await client.query(`
      INSERT INTO withdrawals (user_id, amount, type)
      VALUES ($1, $2, $3)
    `, [userId, amount, eligible_for_withdrawal ? 'combined' : 'capital']);

    await client.query('COMMIT');
    res.json({ message: 'Withdrawal successful' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Withdrawal error:', err);
    res.status(500).json({ message: 'Failed to process withdrawal' });
  } finally {
    client.release();
  }
  console.error("Withdraw error:", err.message || err);

});



// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
