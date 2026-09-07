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
    const accountType =
      String(
        req.query.accountType || 'DEMO'
      ).toUpperCase();

    const cycle =
      await cycleService.getCurrentCycle(
        req.user.id,
        accountType
      );

    return res.json({ cycle });

  } catch (err) {
    console.error(
      'GET CURRENT CYCLE ERROR:',
      err
    );

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
      walletId,
      capitalAmount,
      expectedProfit,
      durationMonths
    } = req.body;

    if (!walletId) {
      return res.status(400).json({
        message: 'walletId is required'
      });
    }

    const cycle =
      await cycleService.startCycle({
        userId: req.user.id,
        walletId,
        capitalAmount,
        expectedProfit,
        durationMonths
      });

    return res.json({ cycle });

  } catch (err) {
    console.error(
      'START CYCLE ERROR:',
      err
    );

    return res.status(400).json({
      message: err.message || 'Unable to start cycle'
    });
  }
});


/**
 * GET /api/cycle/active
 */
router.get('/active', auth, async (req, res) => {
  try {
    const accountType =
      String(
        req.query.accountType || 'DEMO'
      ).toUpperCase();

    if (!['DEMO', 'LIVE'].includes(accountType)) {
      return res.status(400).json({
        message: 'Invalid account type'
      });
    }

    const cycles =
      await cycleService.getActiveCycles(
        req.user.id,
        accountType
      );

    return res.json({ cycles });

  } catch (err) {
    console.error(
      'GET ACTIVE CYCLES ERROR:',
      err
    );

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

    if (!cycleId) {
      return res.status(400).json({
        message: 'cycleId is required'
      });
    }

    const cycle =
      await cycleService.stopCycle({
        userId: req.user.id,
        cycleId
      });

    return res.json({ cycle });

  } catch (err) {
    console.error(
      'FORFEIT CYCLE ERROR:',
      err
    );

    return res.status(400).json({
      message: err.message || 'Unable to forfeit cycle'
    });
  }
});


/**
 * GET /api/cycle/completed
 */
router.get('/completed', auth, async (req, res) => {
  try {
    const accountType =
      String(
        req.query.accountType || 'DEMO'
      ).toUpperCase();

    if (!['DEMO', 'LIVE'].includes(accountType)) {
      return res.status(400).json({
        message: 'Invalid account type'
      });
    }

    const cycles =
      await cycleService.getCompletedCycles(
        req.user.id,
        accountType
      );

    return res.json({ cycles });

  } catch (err) {
    console.error(
      'GET COMPLETED CYCLES ERROR:',
      err
    );

    return res.status(500).json({
      message: err.message || 'Server error'
    });
  }
});


module.exports = router;