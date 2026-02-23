'use strict';
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({
    USD_NGN: 1500
  });
});

module.exports = router;