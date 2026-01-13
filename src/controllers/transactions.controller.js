'use strict';

const { pool } = require('../config/database');

async function getMyTransactions(req, res) {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT
        le.id,
        le.type,
        le.amount_cents,
        le.created_at
      FROM ledger_entries le
      WHERE le.user_id = $1
      ORDER BY le.created_at DESC
      LIMIT 100
      `,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('getMyTransactions error:', err);
    res.status(500).json({ message: 'Failed to load transactions' });
  }
}

module.exports = {
  getMyTransactions
};
