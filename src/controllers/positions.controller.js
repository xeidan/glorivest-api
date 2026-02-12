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
    console.error('positions error:', err);
    res.status(500).json({ message: 'Failed to load positions' });
  } finally {
    client.release();
  }
}


async function getPositionsAnalytics(req, res) {

  const userId = req.user.id;
  const client = await pool.connect();

  try {

    const tradesRes = await client.query(
      `
      SELECT
        opened_at,
        CASE
          WHEN side IN ('LONG','BUY')
            THEN (exit_price - entry_price) * size
          WHEN side IN ('SHORT','SELL')
            THEN (entry_price - exit_price) * size
          ELSE 0
        END AS pnl
      FROM positions
      WHERE user_id = $1
      ORDER BY opened_at ASC
      `,
      [userId]
    );

    const trades = tradesRes.rows;

    if (!trades.length) {
      return res.json({
        summary: null,
        equity_curve: []
      });
    }

    let totalTrades = trades.length;
    let wins = 0;
    let totalPnl = 0;
    let best = -Infinity;
    let worst = Infinity;

    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;

    const equityCurve = [];

    for (const trade of trades) {

      const pnl = Number(trade.pnl);

      totalPnl += pnl;
      equity += pnl;

      if (pnl > 0) wins++;
      if (pnl > best) best = pnl;
      if (pnl < worst) worst = pnl;

      if (equity > peak) peak = equity;

      const drawdown = peak - equity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      equityCurve.push({
        opened_at: trade.opened_at,
        equity,
        drawdown
      });
    }

    const maxDrawdownPct = peak > 0
      ? (maxDrawdown / peak) * 100
      : 0;

    const summary = {
      total_trades: totalTrades,
      win_rate: Number(((wins / totalTrades) * 100).toFixed(2)),
      total_pnl: Number(totalPnl.toFixed(2)),
      avg_pnl: Number((totalPnl / totalTrades).toFixed(2)),
      best_trade: Number(best.toFixed(2)),
      worst_trade: Number(worst.toFixed(2)),
      max_drawdown: Number(maxDrawdown.toFixed(2)),
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(2))
    };

    res.json({
      summary,
      equity_curve: equityCurve
    });

  } catch (err) {
    console.error('analytics error:', err);
    res.status(500).json({ message: 'Failed to load analytics' });
  } finally {
    client.release();
  }
}

module.exports = { getUserPositions, getPositionsAnalytics };
