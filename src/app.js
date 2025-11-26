'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const walletRoutes = require('./routes/wallet.routes');
const depositRoutes = require('./routes/deposit.routes');
const withdrawalRoutes = require('./routes/withdraw.routes');
const leaderboardRoutes = require('./routes/leaderboard.routes');
const notifyRoutes = require('./routes/notify.routes');
const botRoutes = require('./routes/bot.routes');
const accountRoutes = require('./routes/account.routes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===========================
// CORS — must be FIRST
// ===========================
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Must explicitly handle preflight
app.options('*', cors());

// ===========================
// LOGGING
// ===========================
app.use(morgan('dev'));

// ===========================
// ROUTES
// ===========================
app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/deposit', depositRoutes);
app.use('/withdraw', withdrawalRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/notify', notifyRoutes);
app.use('/bot', botRoutes);
app.use('/accounts', accountRoutes);

// ===========================
// 404
// ===========================
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
