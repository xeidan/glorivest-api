// src/routes/leaderboard.routes.js
'use strict';

const router = require('express').Router();
const leaderboardCtrl = require('../controllers/leaderboard.controller');

router.get('/', leaderboardCtrl.getLeaderboard);
router.get('/earnings', leaderboardCtrl.getTopEarners);

module.exports = router;
