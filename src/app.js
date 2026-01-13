// app.js
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes');

const app = express();

app.use(cors());
app.use(express.json());            // ✅ ONLY THIS
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use('/api', routes);             // ✅ SINGLE ENTRY POINT

app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
