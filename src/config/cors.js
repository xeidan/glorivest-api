// src/config/cors.js
// Central CORS config exported as middleware
'use strict';

const cors = require('cors');

const allowedOrigins = [
  'https://glorivest.com',
  'https://www.glorivest.com',
  'http://localhost:3000',
  'http://127.0.0.1:5503',
  'http://127.0.0.1:5503/',
];

module.exports = cors({
  origin: function (origin, callback) {
  if (!origin) return callback(null, true);

  // allow localhost entirely
  if (origin.includes('127.0.0.1') || origin.includes('localhost')) {
    return callback(null, true);
  }

  if (allowedOrigins.includes(origin)) return callback(null, true);

  console.error('❌ Blocked by CORS:', origin);
  return callback(new Error('Not allowed by CORS'));
},
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});
