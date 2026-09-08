'use strict';

const { pool } = require('../config/database');

/**
 * Paginated performance list
 */
async function getUserPerformance(req, res) {

  const userId = req.user.id;

  const page = Math.max(Number(req.query.page || 1), 1);
  const pageSize = Math.min(Number(req.query.page_size || 10), 50);
  const offset = (page - 1) * pageSize;

  const client = await pool.connect();

  try {

    const { rows } = await client.query(
      `
      SELECT
        id,
        symbol,
        side,
        qty AS size,
        entry_price,
        exit_price,
        CASE
          WHEN side IN ('LONG','BUY')
            THEN (exit_price - entry_price) * qty
          WHEN side IN ('SHORT','SELL')
            THEN (entry_price - exit_price) * qty
          ELSE 0
        END AS pnl,
        status,
        opened_at,
        closed_at
      FROM positions
      WHERE user_id = $1
      ORDER BY opened_at DESC
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
    console.error('performance error', err);
    res.status(500).json({ message: 'Failed to load performance' });
  } finally {
    client.release();
  }
}

/**
 * Performance analytics
 */
async function getUserPerformanceAnalytics(req, res) {

  const userId = req.user.id;
  const client = await pool.connect();

  try {

    const { rows: trades } = await client.query(
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

    if (!trades.length) {
      return res.json({
        summary: null,
        equity_curve: []
      });
    }

    let wins = 0;
    let best = -Infinity;
    let worst = Infinity;
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;

    const equityCurve = [];

    for (const trade of trades) {

      const pnl = Number(trade.pnl);

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

    const totalTrades = trades.length;
    const totalPnl = equity;
    const maxDrawdownPct =
      peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    res.json({
      summary: {
        total_trades: totalTrades,
        win_rate: Number(((wins / totalTrades) * 100).toFixed(2)),
        total_pnl: Number(totalPnl.toFixed(2)),
        avg_pnl: Number((totalPnl / totalTrades).toFixed(2)),
        best_trade: Number(best.toFixed(2)),
        worst_trade: Number(worst.toFixed(2)),
        max_drawdown: Number(maxDrawdown.toFixed(2)),
        max_drawdown_pct: Number(maxDrawdownPct.toFixed(2))
      },
      equity_curve: equityCurve
    });

  } catch (err) {
    console.error('analytics error', err);
    res.status(500).json({ message: 'Failed to load analytics' });
  } finally {
    client.release();
  }
}

async function getPerformanceSummary(req, res) {

  const userId = req.user.id;
  const client = await pool.connect();

  try {

    const cycleRes = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    );

    if (!cycleRes.rowCount) {
      return res.json({ summary: null });
    }

    const cycle = cycleRes.rows[0];

    let totalPnl;

    if (cycle.status === 'COMPLETED') {

      totalPnl = cycle.realized_profit_cents / 100;

    } else {

      const pnlRes = await client.query(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN side = 'LONG'
              THEN (exit_price - entry_price) * size
            WHEN side = 'SHORT'
              THEN (entry_price - exit_price) * size
            ELSE 0
          END
        ),0) AS total_pnl
        FROM positions
        WHERE cycle_id = $1
          AND status = 'CLOSED'
        `,
        [cycle.id]
      );

      totalPnl = Number(pnlRes.rows[0].total_pnl);
    }

    res.json({
      cycle_id: cycle.id,
      status: cycle.status,
      capital: cycle.capital_cents / 100,
      total_pnl: Number(totalPnl.toFixed(2))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load performance summary' });
  } finally {
    client.release();
  }
}


module.exports = {
  getUserPerformance,
  getUserPerformanceAnalytics,
  getPerformanceSummary
};
