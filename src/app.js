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

// ------------------------------------------------------
// 1. CORS (MUST BE FIRST)
// ------------------------------------------------------
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// ------------------------------------------------------
// 2. BODY PARSERS
// ------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------
// 3. LOGGING
// ------------------------------------------------------
app.use(morgan('dev'));

// ------------------------------------------------------
// 4. ROUTES
// ------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/deposit', depositRoutes);
app.use('/withdraw', withdrawalRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/notify', notifyRoutes);
app.use('/bot', botRoutes);

// 🔑 IMPORTANT: mount BOTH paths (frontend uses both)
app.use('/accounts', accountRoutes);
app.use('/account', accountRoutes);

// ------------------------------------------------------
// 5. 404 HANDLER
// ------------------------------------------------------
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;
