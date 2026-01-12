'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');
const cycleService = require('../services/cycle.service');


/**
 * GET /api/cycle/current?walletId=35
 */
router.get('/current', auth, async (req, res) => {
  try {
    const walletId = Number(req.query.walletId);
    if (!walletId) {
      return res.status(400).json({ message: 'walletId is required' });
    }

    // Load wallet
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

    // Fetch active cycle
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
 * body: { walletId, expectedProfit }
 */

router.post('/start', auth, async (req, res) => {
  try {
    const idempotencyKey = req.header('Idempotency-Key');

    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Idempotency-Key header is required'
      });
    }

    const cycle = await cycleService.startCycle({
      userId: req.user.id,
      walletId: req.body.walletId,
      capitalAmount: req.body.capitalAmount,
      expectedProfit: req.body.expectedProfit,
      idempotencyKey
    });

    res.json({ cycle });

  } catch (err) {
    res.status(err.statusCode || 400).json({
      error: err.message
    });
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

    // ensure wallet belongs to user
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



// POST /api/cycle/forfeit
router.post('/forfeit', auth, async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: 'cycleId required' });
    }

    const cycle = await cycleService.forfeitCycle({
      userId: req.user.id,
      cycleId
    });

    res.json({ cycle });

  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Server error'
    });
  }
});


module.exports = router;
