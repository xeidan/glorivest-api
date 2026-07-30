'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const maintenance = require('./middleware/maintenance');
const routes = require('./routes');

const app = express();

console.log('DATABASE_URL:', process.env.DATABASE_URL);

/* ======================================================
   CORS
====================================================== */
app.use(
  cors({
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
  })
);

/* ======================================================
   BODY PARSERS
====================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================================================
   MAINTENANCE MODE
====================================================== */
app.use(maintenance);

/* ======================================================
   LOGGING
====================================================== */
app.use(morgan('dev'));

/* ======================================================
   RATE LIMITERS
====================================================== */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});

const moneyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

app.use('/api/deposit', moneyLimiter);
app.use('/api/withdrawals', moneyLimiter);

//
app.get('/', (req, res) => {
  res.json({
    name: 'Glorivest API',
    version: '1.0.0',
    status: 'running'
  });
});

/* ======================================================
   API ROUTES
====================================================== */
app.use('/api', routes);

// Market snapshots
app.use(
  '/api/market-snapshot',
  require('./routes/marketSnapshot.routes')
);

/* ======================================================
   404 HANDLER
====================================================== */
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found'
  });
});

module.exports = app;