'use strict';

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');

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
    const walletId = Number(req.body.walletId);
    const expectedProfit = Number(req.body.expectedProfit);

    if (!walletId || !expectedProfit) {
      return res.status(400).json({
        message: 'walletId and expectedProfit are required'
      });
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

    // Ensure no active cycle
    const activeRes = await pool.query(
      `
      SELECT id
      FROM investment_cycles
      WHERE wallet_id = $1 AND status = 'active'
      LIMIT 1
      `,
      [walletId]
    );

    if (activeRes.rows.length) {
      return res.status(400).json({
        message: 'Active investment cycle already exists'
      });
    }

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const insertRes = await pool.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, start_at, end_at, expected_profit, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
      `,
      [req.user.id, walletId, startAt, endAt, expectedProfit]
    );

    return res.json({ cycle: insertRes.rows[0] });
  } catch (err) {
    console.error('start cycle error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
