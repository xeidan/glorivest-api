'use strict';

const Router = require('express').Router;
const auth = require('../middleware/auth');
const { getMyTransactions } = require('../controllers/transactions.controller');

const router = Router();
console.log('getMyTransactions =', typeof getMyTransactions);

router.get('/', auth, getMyTransactions);

module.exports = router;
