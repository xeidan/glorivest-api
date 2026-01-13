// app.js
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes'); // index.js

const app = express();

app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(morgan('dev'));

// ✅ SINGLE ENTRY POINT
app.use('/api', routes);

// 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
