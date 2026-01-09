'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const {
  startCycle,
  stopCycle
} = require('../controllers/cycle.controller');
const {
  getCurrentCycle
} = require('../controllers/cycle.controller');

// -----------------------------
// START CYCLE
// POST /api/cycle/start
// -----------------------------
router.post('/start', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { walletId, expectedProfit } = req.body;

    const cycle = await startCycle({
      userId,
      walletId,
      expectedProfit
    });

    res.json({ cycle });
  } catch (err) {
    console.error('start cycle error', err);
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------
// STOP CYCLE
// POST /api/cycle/stop
// -----------------------------
router.post('/stop', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { walletId } = req.body;

    const cycle = await stopCycle({
      userId,
      walletId
    });

    res.json({ cycle });
  } catch (err) {
    console.error('stop cycle error', err);
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------
// GET CURRENT CYCLE
// GET /api/cycle/current?walletId=ID
// -----------------------------
router.get('/current', auth, getCurrentCycle);

module.exports = router;
