// src/routes/leaderboard.routes.js
'use strict';

const express = require('express');
const router = express.Router();

const leaderboardController = require('../controllers/leaderboard.controller');

// DEBUG GUARD (important)
if (!leaderboardController || typeof leaderboardController.getLeaderboard !== 'function') {
  throw new Error('leaderboard.controller.getLeaderboard is undefined');
}

router.get('/', leaderboardController.getLeaderboard);

module.exports = router;

