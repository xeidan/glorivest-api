'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes'); // routes/index.js

const app = express();

/* ======================================================
   CORS — MUST COME FIRST
====================================================== */
app.use(cors({
  origin: [
    'http://127.0.0.1:5503',
    'http://localhost:5503',
    // add production frontend here when ready
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Idempotency-Key'
  ],
  credentials: false
}));

// Handle preflight explicitly (important)
app.options('*', cors());

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

/* ======================================================
   404 FALLBACK
====================================================== */
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
