// src/routes/account.routes.js
'use strict';

const router = require('express').Router();
const accountCtrl = require('../controllers/account.controller');
const auth = require('../middleware/auth');

router.get('/', auth, accountCtrl.getMyAccounts);
router.get('/:id', auth, accountCtrl.getAccountById);
router.post('/', auth, accountCtrl.createAccount);

module.exports = router;
