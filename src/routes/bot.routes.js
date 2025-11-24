// src/routes/bot.routes.js
'use strict';

const router = require('express').Router();
const botCtrl = require('../controllers/bot.controller');
const auth = require('../middleware/auth');

router.post('/start', auth, botCtrl.startBot);
router.post('/stop', auth, botCtrl.stopBot);
router.get('/status', auth, botCtrl.status);

module.exports = router;
