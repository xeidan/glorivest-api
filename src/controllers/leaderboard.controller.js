'use strict';

const pool = require('../config/database').pool;

// src/controllers/leaderboard.controller.js

exports.getLeaderboard = async (req, res) => {
  try {
    // TODO: real query later
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load leaderboard' });
  }
};

