'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const cycleService = require('../controllers/cycle.controller');

/**
 * GET /api/cycle/current
 */
router.get('/current', auth, async (req, res) => {
  try {
    const cycle = await cycleService.getCurrentCycle(req.user.id);

    return res.json({ cycle });

  } catch (err) {
    console.error('GET CURRENT CYCLE ERROR:', err);
    return res.status(500).json({
      message: err.message || 'Server error'
    });
  }
});


/**
 * POST /api/cycle/start
 */
router.post('/start', auth, async (req, res) => {
  try {
    const {
      capitalAmount,
      expectedProfit,
      durationMonths
    } = req.body;

    const cycle = await cycleService.startCycle({
      userId: req.user.id,
      capitalAmount,
      expectedProfit,
      durationMonths
    });

    return res.json({ cycle });

  } catch (err) {
    console.error('START CYCLE ERROR:', err);
    return res.status(400).json({
      message: err.message
    });
  }
});


/**
 * GET /api/cycle/active
 */
router.get('/active', auth, async (req, res) => {
  try {
    const cycles = await cycleService.getActiveCycles(
      req.user.id
    );

    return res.json({ cycles });

  } catch (err) {
    console.error('GET ACTIVE CYCLES ERROR:', err);
    return res.status(500).json({
      message: err.message || 'Server error'
    });
  }
});


/**
 * POST /api/cycle/forfeit
 */
router.post('/forfeit', auth, async (req, res) => {
  try {
    const { cycleId } = req.body;

    const cycle = await cycleService.stopCycle({
      userId: req.user.id,
      cycleId
    });

    return res.json({ cycle });

  } catch (err) {
    console.error('FORFEIT CYCLE ERROR:', err);
    return res.status(400).json({
      message: err.message
    });
  }
});


/**
 * GET /api/cycle/completed
 */
router.get('/completed', auth, async (req, res) => {
  try {
    const cycles = await cycleService.getCompletedCycles(
      req.user.id
    );

    return res.json({ cycles });

  } catch (err) {
    console.error('GET COMPLETED CYCLES ERROR:', err);
    return res.status(500).json({
      message: err.message || 'Server error'
    });
  }
});

module.exports = router;