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
  const { walletId, capitalAmount, expectedProfit } = req.body;

  if (!walletId || !capitalAmount || capitalAmount <= 0) {
    return res.status(400).json({ message: 'walletId and capitalAmount required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Load wallet
    const walletRes = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [walletId, req.user.id]
    );

    if (!walletRes.rows.length) {
      throw { statusCode: 404, message: 'Wallet not found' };
    }

    const wallet = walletRes.rows[0];
    requireLiveAccount(wallet);

    // 2️⃣ Ensure sufficient balance
    if (Number(wallet.balance_cents) < Number(capitalAmount)) {
      throw { statusCode: 400, message: 'Insufficient wallet balance' };
    }

    // 3️⃣ Deduct capital from wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1,
          updated_at = now()
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    // 4️⃣ Create cycle
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const cycleRes = await client.query(
      `
      INSERT INTO investment_cycles
        (user_id, wallet_id, start_at, end_at, capital_amount, expected_profit, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING *
      `,
      [
        req.user.id,
        walletId,
        startAt,
        endAt,
        capitalAmount,
        expectedProfit
      ]
    );

    await client.query('COMMIT');

    return res.json({ cycle: cycleRes.rows[0] });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('cycle start error:', err);

    return res.status(err.statusCode || 500).json({
      error: err.message || 'Server error'
    });
  } finally {
    client.release();
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
      return res.status(400).json({ message: 'cycleId is required' });
    }

    const cycle = await cycleService.stopCycle({
      userId: req.user.id,
      cycleId
    });

    res.json({ cycle });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


module.exports = router;
