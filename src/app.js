// app.js
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes');

const app = express();

// 1. CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// 2. Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Logging
app.use(morgan('dev'));

// 4. API (🔥 ONLY THIS 🔥)
app.use('/api', routes);

// 5. 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
