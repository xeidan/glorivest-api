'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const maintenance = require('./middleware/maintenance');

const routes = require('./routes'); // routes/index.js

const app = express();

/* ======================================================
   CORS — MUST COME FIRST
====================================================== */
app.use(cors({
origin: [
  'http://127.0.0.1:5503',
  'http://localhost:5503',
  'https://www.glorivest.com',
  'https://glorivest.com',
  'https://xeidan.github.io'
],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Idempotency-Key'
  ]
}));


/* ======================================================
   MIDDLEWARE
====================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

/* ======================================================
   ROUTES
====================================================== */
app.use('/api', routes);

// MARKET SNAPSHOTS (explicit mount)
app.use(
  '/api/market-snapshot',
  require('./routes/marketSnapshot.routes')
);


/* ======================================================
   404 FALLBACK
====================================================== */
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});


/* ======================================================
   RATE LIMITER
====================================================== */
const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
});

app.use(globalLimiter);

const moneyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20
});

app.use('/api/deposit', moneyLimiter);
app.use('/api/withdrawals', moneyLimiter);


module.exports = app;
