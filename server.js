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
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.error('Blocked CORS:', origin);
    cb(new Error('CORS not allowed'));
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

// ===== RESEND OTP =====
app.post('/resend-otp', otpResendLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('UPDATE users SET otp = $1, otp_created_at = NOW() WHERE email = $2', [otp, email]);

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@glorivest.com',
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
    res.status(200).json({ message: 'OTP resent successfully' });
  } catch (err) {
    console.error('Error resending OTP:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ===== LOGIN =====
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'All fields are required' });

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


// ===== REGISTER =====
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'All fields are required' });

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(`
      INSERT INTO users (email, password, otp, otp_created_at, is_verified, created_at)
      VALUES ($1, $2, $3, NOW(), false, NOW())
    `, [email, hashedPassword, otp]);

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@glorivest.com',
      subject: 'Your Glorivest OTP Code',
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center;">
          <h2>🔐 Verify Your Email</h2>
          <p>Enter this code in the app to verify your email:</p>
          <h1 style="font-size: 2rem; color: #00D2B1;">${otp}</h1>
          <p>Code expires in 10 minutes.</p>
        </div>
      `,
    };

    await sgMail.send(msg);

    res.status(201).json({ message: 'Signup successful. OTP sent.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ===== VERIFY OTP =====
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

  try {
    const result = await pool.query('SELECT otp, otp_created_at FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const sentAt = new Date(user.otp_created_at);
    const diffInMin = (now - sentAt) / 1000 / 60;

    if (diffInMin > 10) return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
    if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

    await pool.query('UPDATE users SET otp = NULL, otp_created_at = NULL, verified = true WHERE email = $1', [email]);
    res.status(200).json({ message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ===== Server Init =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Booting...');
  console.log(`Server running on port ${PORT}`);
});
