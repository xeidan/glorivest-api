'use strict';

const { pool } = require('../config/database');

async function getUserPositions(req, res) {
  const userId = req.user.id;

  const page = Math.max(Number(req.query.page || 1), 1);
  const pageSize = Math.min(Number(req.query.page_size || 10), 50);
  const offset = (page - 1) * pageSize;

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `
      SELECT
        p.id,
        p.symbol,
        p.side,
        p.size,
        p.entry_price,
        p.exit_price,
        p.pnl_cents,
        p.status,
        p.opened_at,
        p.closed_at
      FROM positions p
      WHERE p.user_id = $1
      ORDER BY
        CASE WHEN p.status = 'OPEN' THEN 0 ELSE 1 END,
        p.opened_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, pageSize, offset]
    );

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) FROM positions WHERE user_id = $1`,
      [userId]
    );

    const total = Number(countRows[0].count);
    const pages = Math.max(Math.ceil(total / pageSize), 1);

    res.json({
      data: rows,
      page,
      pages,
      total
    });

  } catch (err) {
    console.error('positions error', err);
    res.status(500).json({ message: 'Failed to load positions' });
  } finally {
    client.release();
  }
}

module.exports = { getUserPositions };
