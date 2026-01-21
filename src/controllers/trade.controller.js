'use strict';

const { pool } = require('../config/database');
const { getTier, getRoiPercent } = require('../utils/roi');



const BOT_FEE_CENTS = 500; // $5

/**
 * START TRADE CYCLE
 */
const startTrade = async (req, res) => {
  const userId = req.user.id;
  const { amount_cents, wallet_type, duration_months } = req.body;

  // ---------------------------
  // 1️⃣ Validate inputs
  // ---------------------------
  if (!amount_cents || Number(amount_cents) <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  if (![1, 3, 6].includes(Number(duration_months))) {
    return res.status(400).json({ message: 'Invalid duration' });
  }

  if (!['REAL', 'DEMO'].includes(wallet_type)) {
    return res.status(400).json({ message: 'Invalid wallet type' });
  }

  const capital = Number(amount_cents);

  // ---------------------------
  // 2️⃣ Determine tier + ROI (LOCK CONTRACT)
  // ---------------------------
  let tier, roiPercent;
  try {
    tier = getTier(capital);
    roiPercent = getRoiPercent(tier, Number(duration_months));
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const expectedProfitCents = Math.floor(
    capital * (roiPercent / 100)
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ---------------------------
    // 3️⃣ Lock wallet
    // ---------------------------
    const { rows } = await client.query(
      `
      SELECT id, balance_cents
      FROM wallets
      WHERE user_id = $1
        AND type = $2
      FOR UPDATE
      `,
      [userId, wallet_type]
    );

    if (!rows.length) {
      throw new Error('Wallet not found');
    }

    const wallet = rows[0];

    if (Number(wallet.balance_cents) < capital) {
      throw new Error('Insufficient balance');
    }

    // ---------------------------
    // 4️⃣ Deduct capital
    // ---------------------------
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capital, wallet.id]
    );

    // ---------------------------
    // 5️⃣ Create trading cycle (ALL TERMS FIXED)
    // ---------------------------
    const { rows: cycleRows } = await client.query(
      `
      INSERT INTO trading_cycles (
        user_id,
        wallet_type,
        capital_cents,
        tier,
        duration_months,
        roi_percent,
        expected_profit_cents,
        status,
        started_at,
        completes_at
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        'RUNNING',
        NOW(),
        NOW() + ($5 || ' months')::INTERVAL
      )
      RETURNING *
      `,
      [
        userId,
        wallet_type,
        capital,
        tier,
        duration_months,
        roiPercent,
        expectedProfitCents
      ]
    );

    await client.query('COMMIT');

    return res.json({ cycle: cycleRows[0] });

  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};



/**
 * COMPLETE TRADE CYCLE (SYSTEM-ONLY)
 * ❗ NOT CALLED BY CLIENT DIRECTLY
 */
const completeCycle = async (cycleId, client) => {
  // This will be used later by:
  // - cron
  // - worker
  // - admin process
};


/**
 * GET TRADE SUMMARY (Overview tab)
 */
const getTradeSummary = async (req, res) => {
  const userId = req.user.id;

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(capital_cents),0) AS total_active_capital_cents,
      COUNT(*) AS active_cycle_count
    FROM trading_cycles
    WHERE user_id = $1 AND status = 'RUNNING'
    `,
    [userId]
  );

  const { rows: profitRows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(profit_cents),0) AS total_realized_profit_cents
    FROM trading_cycles
    WHERE user_id = $1 AND status = 'COMPLETED'
    `,
    [userId]
  );

  res.json({
    total_active_capital_cents: rows[0].total_active_capital_cents,
    active_cycle_count: Number(rows[0].active_cycle_count),
    total_realized_profit_cents: profitRows[0].total_realized_profit_cents
  });
};



/**
 * GET ACTIVE TRADE CYCLES
 */
const getActiveTrades = async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        tc.id,
        tc.tier,
        tc.capital_cents,
        tc.duration_months,
        tc.roi_percent,
        tc.expected_profit_cents,
        tc.started_at,
        tc.ends_at,

        GREATEST(
          0,
          LEAST(
            100,
            ROUND(
              (
                EXTRACT(EPOCH FROM (NOW() - tc.started_at)) /
                EXTRACT(EPOCH FROM (tc.ends_at - tc.started_at))
              ) * 100
            )
          )
        ) AS progress_percent,

        FLOOR(
          EXTRACT(EPOCH FROM (NOW() - tc.started_at)) / 86400
        ) AS days_run

      FROM trade_cycles tc
      WHERE tc.user_id = $1
        AND tc.status = 'ACTIVE'
      ORDER BY tc.started_at DESC
      `,
      [userId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Active trades error:', err);
    return res.status(500).json({ message: 'Failed to load active trades' });
  }
};


/**
 * STOP TRADE CYCLE EARLY (FORFEIT PROFITS)
 */
const stopTrade = async (req, res) => {
  const userId = req.user.id;
  const { trade_cycle_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT * FROM trading_cycles
      WHERE id=$1 AND user_id=$2 AND status='RUNNING'
      FOR UPDATE
      `,
      [trade_cycle_id, userId]
    );

    if (!rows.length) throw new Error('Cycle not found');
    const c = rows[0];

    // return capital ONLY
    await client.query(
      `UPDATE wallets SET balance_cents = balance_cents + $1
       WHERE user_id=$2 AND type=$3`,
      [c.capital_cents, userId, c.wallet_type]
    );

    await client.query(
      `
      UPDATE trading_cycles
      SET status='STOPPED',
          stopped_early=true,
          completed_at=NOW(),
          profit_cents=0
      WHERE id=$1
      `,
      [trade_cycle_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Cycle stopped' });

  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
};



/**
 * GET TRADE PROFITS (Transfer tab)
 */
const getTradeProfits = async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        tp.trade_cycle_id,
        tp.profit_cents,
        tp.transferred,
        tp.created_at
      FROM trade_profits tp
      WHERE tp.user_id = $1
      ORDER BY tp.created_at DESC
      `,
      [userId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Get profits error:', err);
    return res.status(500).json({ message: 'Failed to load profits' });
  }
};




/**
 * TRANSFER ALL AVAILABLE PROFITS TO REAL WALLET
 */
const transferTradeProfits = async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, profit_cents
      FROM trading_cycles
      WHERE user_id = $1
        AND status = 'COMPLETED'
        AND profit_cents > 0
        AND profit_transferred = false
      FOR UPDATE
      `,
      [userId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.json({ transferred_cents: 0 });
    }

    const total = rows.reduce(
      (sum, r) => sum + Number(r.profit_cents), 0
    );

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE user_id = $2 AND type = 'REAL'
      `,
      [total, userId]
    );

    await client.query(
      `
      UPDATE trading_cycles
      SET profit_transferred = true
      WHERE id = ANY($1::int[])
      `,
      [rows.map(r => r.id)]
    );

    await client.query('COMMIT');

    res.json({ transferred_cents: total });

  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Transfer failed' });
  } finally {
    client.release();
  }
};




// controllers/trade.controller.js
const getActiveCycles = async (req, res) => {
  const userId = req.user.id;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      capital_cents,
      duration_months,
      roi_percent,
      expected_profit_cents,
      started_at,
      completes_at,
      EXTRACT(DAY FROM (NOW() - started_at))::INT AS days_run,
      LEAST(
        100,
        ROUND(
          (EXTRACT(EPOCH FROM (NOW() - started_at)) /
           EXTRACT(EPOCH FROM (completes_at - started_at))) * 100
        )
      )::INT AS progress_percent,
      CASE
        WHEN capital_cents >= 500000 THEN 'Elite'
        WHEN capital_cents >= 50000 THEN 'Pro'
        ELSE 'Standard'
      END AS tier
    FROM trading_cycles
    WHERE user_id = $1
      AND status = 'RUNNING'
    ORDER BY started_at ASC
    `,
    [userId]
  );

  res.json(rows);
};


const getTradeHistory = async (req, res) => {
  const userId = req.user.id;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      capital_cents,
      profit_cents,
      duration_months,
      roi_percent,
      status,
      stopped_early,
      started_at,
      completed_at
    FROM trading_cycles
    WHERE user_id = $1
      AND status IN ('COMPLETED','STOPPED')
    ORDER BY completed_at DESC
    LIMIT 100
    `,
    [userId]
  );

  res.json(rows);
};


const getTransferableProfits = async (req, res) => {
  const userId = req.user.id;

  const { rows } = await pool.query(
    `
    SELECT id, profit_cents
    FROM trading_cycles
    WHERE user_id = $1
      AND status = 'COMPLETED'
      AND profit_cents > 0
      AND profit_transferred = false
    ORDER BY completed_at ASC
    `,
    [userId]
  );

  res.json(rows);
};




/**
 * GET POSITIONS (OPEN + CLOSED)
 */
const getPositions = async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        trading_cycle_id,
        symbol,
        side,
        volume,
        entry_price,
        exit_price,
        status,
        pnl_cents,
        opened_at,
        closed_at
      FROM bot_positions
      WHERE user_id = $1
      ORDER BY opened_at DESC
      `,
      [userId]
    );

    res.json({ positions: rows });
  } catch (err) {
    console.error('Positions error:', err);
    res.status(500).json({ message: 'Failed to load positions' });
  }
};



const getTradeOverview = async (req, res) => {
  return res.json({
    active_cycles: 0,
    total_invested_cents: 0,
    expected_profit_cents: 0,
    realized_profit_cents: 0,
    roi_percent: 0
  });
};






module.exports = {
  startTrade,
  getTradeSummary,
  getActiveTrades,
  stopTrade,
  getTradeProfits,
  transferTradeProfits,
  completeCycle,
  getActiveCycles,
  getTradeHistory,
  getTransferableProfits,
  getTradeOverview,
  getPositions,
};


