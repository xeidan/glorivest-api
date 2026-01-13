'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../config/database');

/**
 * GET /api/transactions
 * Returns ledger entries for the authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        type,
        amount_cents,
        reference_id,
        created_at
      FROM ledger_entries
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /transactions failed:', err);
    res.status(500).json({ message: 'Failed to load transactions' });
  }
});

module.exports = router;