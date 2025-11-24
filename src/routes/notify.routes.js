// src/routes/notify.routes.js
'use strict';

const router = require('express').Router();
const notifyCtrl = require('../controllers/notify.controller');
const auth = require('../middleware/auth');

router.post('/deposit', auth, notifyCtrl.notifyDeposit);
router.post('/withdrawal', auth, notifyCtrl.notifyWithdrawal);
router.post('/broadcast', auth, notifyCtrl.broadcastMessage);

module.exports = router;
