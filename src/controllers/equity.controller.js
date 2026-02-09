'use strict';
const { pool } = require('../config/database');

async function getEquityCurve(req, res) {
  const userId = req.user.id;

  const sql = `
    SELECT
      DATE(wl.created_at) AS day,
      SUM(wl.amount_cents) OVER (
        ORDER BY DATE(wl.created_at)
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS equity_change_cents
    FROM wallet_ledger wl
    JOIN wallets w ON w.id = wl.wallet_id
    WHERE w.user_id = $1
    ORDER BY day;
  `;

  const { rows } = await pool.query(sql, [userId]);

  res.json({
    success: true,
    data: rows.map(r => ({
      day: r.day,
      equity_change_cents: Number(r.equity_change_cents)
    }))
  });
}

module.exports = { getEquityCurve };
