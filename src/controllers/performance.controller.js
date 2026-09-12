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

  const accountType =
    String(req.query.accountType || '').toUpperCase();

  const client = await pool.connect();

  try {
    const params = [userId];
    let accountFilter = '';

    if (accountType === 'DEMO' || accountType === 'LIVE') {
      params.push(accountType);
      accountFilter = `AND a.account_type = $${params.length}`;
    }

    params.push(pageSize);
    const limitParam = params.length;

    params.push(offset);
    const offsetParam = params.length;

    const { rows } = await client.query(
      `
      SELECT
        p.id,
        p.account_id,
        p.cycle_id,
        p.symbol,
        p.side,
        p.qty AS size,
        p.entry_price,
        p.exit_price,
        CASE
          WHEN p.side IN ('LONG', 'BUY')
            THEN (p.exit_price - p.entry_price) * p.qty
          WHEN p.side IN ('SHORT', 'SELL')
            THEN (p.entry_price - p.exit_price) * p.qty
          ELSE 0
        END AS pnl,
        p.status,
        p.opened_at,
        p.closed_at,
        a.account_type
      FROM positions p
      JOIN accounts a
        ON a.id = p.account_id
      WHERE p.user_id = $1
        ${accountFilter}
      ORDER BY p.opened_at DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
      `,
      params
    );

    const countParams = [userId];
    let countFilter = '';

    if (accountType === 'DEMO' || accountType === 'LIVE') {
      countParams.push(accountType);
      countFilter = `
        AND a.account_type = $${countParams.length}
      `;
    }

    const { rows: countRows } = await client.query(
      `
      SELECT COUNT(*)
      FROM positions p
      JOIN accounts a
        ON a.id = p.account_id
      WHERE p.user_id = $1
        ${countFilter}
      `,
      countParams
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
    res.status(500).json({
      message: 'Failed to load performance'
    });
  } finally {
    client.release();
  }
}


/**
 * Performance analytics
 */
async function getUserPerformanceAnalytics(req, res) {
  const userId = req.user.id;

  const accountType =
    String(req.query.accountType || '').toUpperCase();

  const client = await pool.connect();

  try {
    const params = [userId];
    let accountFilter = '';

    if (accountType === 'DEMO' || accountType === 'LIVE') {
      params.push(accountType);
      accountFilter = `AND a.account_type = $${params.length}`;
    }

    const { rows: trades } = await client.query(
      `
      SELECT
        p.opened_at,
        CASE
          WHEN p.side IN ('LONG', 'BUY')
            THEN (p.exit_price - p.entry_price) * p.qty
          WHEN p.side IN ('SHORT', 'SELL')
            THEN (p.entry_price - p.exit_price) * p.qty
          ELSE 0
        END AS pnl
      FROM positions p
      JOIN accounts a
        ON a.id = p.account_id
      WHERE p.user_id = $1
        ${accountFilter}
      ORDER BY p.opened_at ASC
      `,
      params
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

      if (equity > peak) {
        peak = equity;
      }

      const drawdown = peak - equity;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }

      equityCurve.push({
        opened_at: trade.opened_at,
        equity,
        drawdown
      });
    }

    const totalTrades = trades.length;
    const totalPnl = equity;

    const maxDrawdownPct =
      peak > 0
        ? (maxDrawdown / peak) * 100
        : 0;

    res.json({
      summary: {
        total_trades: totalTrades,
        win_rate: Number(
          ((wins / totalTrades) * 100).toFixed(2)
        ),
        total_pnl: Number(totalPnl.toFixed(2)),
        avg_pnl: Number(
          (totalPnl / totalTrades).toFixed(2)
        ),
        best_trade: Number(best.toFixed(2)),
        worst_trade: Number(worst.toFixed(2)),
        max_drawdown: Number(maxDrawdown.toFixed(2)),
        max_drawdown_pct: Number(
          maxDrawdownPct.toFixed(2)
        )
      },
      equity_curve: equityCurve
    });

  } catch (err) {
    console.error('analytics error', err);
    res.status(500).json({
      message: 'Failed to load analytics'
    });
  } finally {
    client.release();
  }
}


/**
 * Performance summary
 */
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
      return res.json({
        summary: null
      });
    }

    const cycle = cycleRes.rows[0];

    let totalPnl;

    if (cycle.status === 'COMPLETED') {
      totalPnl =
        Number(cycle.realized_profit_cents || 0) / 100;

    } else {
      const pnlRes = await client.query(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN side IN ('LONG', 'BUY')
              THEN (exit_price - entry_price) * qty
            WHEN side IN ('SHORT', 'SELL')
              THEN (entry_price - exit_price) * qty
            ELSE 0
          END
        ), 0) AS total_pnl
        FROM positions
        WHERE cycle_id = $1
          AND status = 'CLOSED'
        `,
        [cycle.id]
      );

      totalPnl = Number(
        pnlRes.rows[0].total_pnl
      );
    }

    res.json({
      cycle_id: cycle.id,
      status: cycle.status,
      capital: Number(cycle.capital_cents) / 100,
      total_pnl: Number(totalPnl.toFixed(2))
    });

  } catch (err) {
    console.error('performance summary error', err);
    res.status(500).json({
      message: 'Failed to load performance summary'
    });
  } finally {
    client.release();
  }
}


module.exports = {
  getUserPerformance,
  getUserPerformanceAnalytics,
  getPerformanceSummary
};