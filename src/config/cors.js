// src/config/cors.js
'use strict';

const cors = require('cors');

const allowedOrigins = [
  'https://glorivest.com',
  'https://www.glorivest.com',
  'http://localhost:3000',
  'http://127.0.0.1:5503',
  'http://localhost:5503'
];

const corsOptions = {
  origin: function (origin, callback) {
    // allow server-to-server or curl/postman
    if (!origin) return callback(null, true);

    if (
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error('❌ Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

module.exports = corsOptions;
