'use strict';

const express = require('express');
const router = express.Router();

const rateController = require('../controllers/rate.controller');
const requireAdmin = require('../middleware/requireAdmin');

router.get('/', rateController.getRate);
router.put('/', requireAdmin, rateController.updateRate);

module.exports = router;