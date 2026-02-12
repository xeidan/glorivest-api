'use strict';

const { pool } = require('../config/database');
const { generateTradesForCycle } = require('../services/performanceEngine.service');

async function getPerformanceSummary(req, res) {
  const userId = req.user.id;

  const page = Math.max(Number(req.query.page || 1), 1);
  const pageSize = Math.min(Number(req.query.page_size || 10), 50);
  const offset = (page - 1) * pageSize;

  const client = await pool.connect();

  try {

    // 1️⃣ Get latest active cycle
    const cycleRes = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE user_id = $1
        AND status = 'active'
      LIMIT 1
      `,
      [userId]
    );

    if (cycleRes.rowCount) {
      const cycle = cycleRes.rows[0];

      

    // 2️⃣ Return paginated positions
    const { rows } = await client.query(
      `
      SELECT
        p.id,
        p.symbol,
        p.side,
        p.size,
        p.entry_price,
        p.exit_price,
        CASE
          WHEN p.side IN ('BUY','LONG')
            THEN (p.exit_price - p.entry_price) * p.size
          WHEN p.side IN ('SELL','SHORT')
            THEN (p.entry_price - p.exit_price) * p.size
          ELSE 0
        END AS pnl,
        p.status,
        p.opened_at,
        p.closed_at
      FROM positions p
      WHERE p.user_id = $1
      ORDER BY p.opened_at DESC
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

module.exports = { getPerformanceSummary };
