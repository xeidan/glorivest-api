// src/routes/account.routes.js
'use strict';

const router = require('express').Router();
const accountCtrl = require('../controllers/account.controller');
const auth = require('../middleware/auth');

router.get('/', auth, accountCtrl.getMyAccounts);
router.get('/:id', auth, accountCtrl.getAccountById);

// validate tier_code before controller
router.post('/', auth, (req, res, next) => {
  if (!req.body.tier_code) {
    return res.status(400).json({ message: "tier_code is required: 'standard' | 'pro' | 'elite'" });
  }
  next();
}, accountCtrl.createAccount);

module.exports = router;
