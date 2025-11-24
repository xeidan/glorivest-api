// src/config/cors.js
// Central CORS config exported as middleware
'use strict';

const cors = require('cors');

const allowedOrigins = [
  'https://glorivest.com',
  'https://www.glorivest.com',
  'http://localhost:3000',
  'http://127.0.0.1:5503',
];

module.exports = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin like mobile apps, curl, server-side
    if (!origin) return callback(null, true);

    // exact matches
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // allow any localhost with any port
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }

    console.error('❌ Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});
