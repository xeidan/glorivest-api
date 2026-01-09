'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const {
  startCycle,
  stopCycle,
  getCurrentCycle
} = require('../controllers/cycle.controller');

// ------------------------------------
// START CYCLE
// POST /api/cycle/start
// ------------------------------------
router.post('/start', auth, async (req, res) => {
  try {
    const { walletId, expectedProfit } = req.body;
    const userId = req.user.id;

    if (!walletId || !expectedProfit) {
      return res.status(400).json({ message: 'walletId and expectedProfit required' });
    }

    const cycle = await startCycle({
      userId,
      walletId,
      expectedProfit
    });

    res.json({ cycle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------
// STOP CYCLE
// POST /api/cycle/stop
// ------------------------------------
router.post('/stop', auth, async (req, res) => {
  try {
    const { walletId } = req.body;
    const userId = req.user.id;

    if (!walletId) {
      return res.status(400).json({ message: 'walletId required' });
    }

    const cycle = await stopCycle({ userId, walletId });
    res.json({ cycle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------
// CURRENT CYCLE (READ-ONLY)
// GET /api/cycle/current?walletId=
// ------------------------------------
router.get('/current', auth, async (req, res) => {
  try {
    const walletId = Number(req.query.walletId);
    const userId = req.user.id;

    if (!walletId) {
      return res.status(400).json({ message: 'walletId required' });
    }

    const cycle = await getCurrentCycle({ userId, walletId });
    res.json({ cycle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
