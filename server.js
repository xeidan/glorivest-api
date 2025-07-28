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

// ===== CORS =====
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

app.options('*', cors()); // Handle preflight

// ===== Middleware =====
app.use(express.json());
app.use(morgan('dev'));

// ===== Test Route =====
app.get('/test-cors', (req, res) => {
  res.json({ message: 'CORS is working' });
});
