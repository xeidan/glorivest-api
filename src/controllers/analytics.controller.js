'use strict';
const { pool } = require('../config/database');

async function getStrategyAnalytics(req, res) {
  const userId = req.user.id;

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE pnl_cents > 0) AS wins,
      COUNT(*) FILTER (WHERE pnl_cents < 0) AS losses,
      COUNT(*) AS total_trades,
      COALESCE(AVG(pnl_cents), 0) AS avg_pnl_cents,
      COALESCE(SUM(pnl_cents), 0) AS total_pnl_cents
    FROM positions
    WHERE user_id = $1
      AND status = 'CLOSED'
  `;

  const { rows } = await pool.query(sql, [userId]);
  const r = rows[0];

  res.json({
    success: true,
    data: {
      win_rate: r.total_trades > 0 ? Number(r.wins) / Number(r.total_trades) : 0,
      avg_pnl_cents: Number(r.avg_pnl_cents),
      total_pnl_cents: Number(r.total_pnl_cents),
      total_trades: Number(r.total_trades)
    }
  });
}

module.exports = { getStrategyAnalytics };
