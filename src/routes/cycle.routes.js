'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');
const cycleService = require('../controllers/cycle.controller');


/**
 * GET /api/cycle/current?walletId=35
 */
router.get('/current', auth, async (req, res) => {
  try {
    const walletId = Number(req.query.walletId);
    if (!walletId) {
      return res.status(400).json({ message: 'walletId is required' });
    }

    const walletRes = await pool.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [walletId, req.user.id]
    );

    if (!walletRes.rows.length) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const account = walletRes.rows[0];
    requireLiveAccount(account);

    const cycleRes = await pool.query(
      `
      SELECT
        *,
        LEAST(
          expected_profit,
          expected_profit *
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (now() - start_at)) /
            EXTRACT(EPOCH FROM (end_at - start_at))
          )
        ) AS computed_accrued_profit
      FROM investment_cycles
      WHERE wallet_id = $1
        AND status = 'active'
      LIMIT 1
      `,
      [walletId]
    );

    if (!cycleRes.rows.length) {
      return res.json({ cycle: null });
    }

    return res.json({ cycle: cycleRes.rows[0] });
  } catch (err) {
    console.error('get current cycle error:', err);
    return res.status(500).json({ error: 'Server error' });
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

    if (!durationMonths || durationMonths < 1) {
      return res.status(400).json({ message: 'Invalid duration' });
    }

    const cycle = await cycleService.startCycle({
      userId: req.user.id,
      walletId,
      capitalAmount,
      expectedProfit,
      durationMonths
    });

    res.json({ cycle });

  } catch (err) {
    console.error('START CYCLE ERROR:', err.message);
    res.status(400).json({ message: err.message });
  }
});


/**
 * GET /api/cycle/active?walletId=35
 */
router.get('/active', auth, async (req, res) => {
  try {
    const walletId = Number(req.query.walletId);

    if (!walletId) {
      return res.status(400).json({ message: 'walletId is required' });
    }

    const walletRes = await pool.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [walletId, req.user.id]
    );

    if (!walletRes.rows.length) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const cyclesRes = await pool.query(
      `
      SELECT
        *,
        LEAST(
          expected_profit,
          expected_profit *
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (now() - start_at)) /
            EXTRACT(EPOCH FROM (end_at - start_at))
          )
        ) AS computed_accrued_profit
      FROM investment_cycles
      WHERE wallet_id = $1
        AND status = 'active'
      ORDER BY start_at ASC
      `,
      [walletId]
    );

    return res.json({ cycles: cyclesRes.rows });

  } catch (err) {
    console.error('get active cycles error:', err);
    return res.status(500).json({ error: 'Server error' });
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

    res.json({ cycle });

  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});


/**
 * GET /api/cycle/completed?walletId=35
 */
router.get('/completed', auth, async (req, res) => {
  try {
    const walletId = Number(req.query.walletId);

    if (!walletId) {
      return res.status(400).json({ message: 'walletId is required' });
    }

    const cyclesRes = await pool.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE wallet_id = $1
        AND status = 'completed'
      ORDER BY end_at DESC
      `,
      [walletId]
    );

    return res.json({ cycles: cyclesRes.rows });

  } catch (err) {
    console.error('get completed cycles error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
