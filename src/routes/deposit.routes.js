// src/routes/deposit.routes.js
'use strict';

const express = require('express');
const router = express.Router();

const { depositWebhook } = require('../controllers/deposit.controller');

// Webhook endpoint
router.post('/webhook', depositWebhook);

module.exports = router;

