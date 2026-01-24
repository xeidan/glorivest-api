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
  const { rows } = await client.query(
    `
    SELECT *
    FROM trading_cycles
    WHERE id = $1
      AND status = 'RUNNING'
    FOR UPDATE
    `,
    [cycleId]
  );

  if (!rows.length) return; // idempotent exit

  const c = rows[0];

  const profitCents = c.expected_profit_cents;

  // 1️⃣ Mark cycle completed
  await client.query(
    `
    UPDATE trading_cycles
    SET
      status = 'COMPLETED',
      completed_at = NOW(),
      profit_cents = $2
    WHERE id = $1
    `,
    [cycleId, profitCents]
  );

  // ❗ DO NOT TOUCH WALLET HERE
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
    WHERE user_id = $1
      AND status = 'RUNNING'
    `,
    [userId]
  );

  const { rows: profitRows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(profit_cents),0) AS total_realized_profit_cents
    FROM trading_cycles
    WHERE user_id = $1
      AND status = 'COMPLETED'
    `,
    [userId]
  );

  res.json({
    total_active_capital_cents: Number(rows[0].total_active_capital_cents),
    active_cycle_count: Number(rows[0].active_cycle_count),
    total_realized_profit_cents: Number(profitRows[0].total_realized_profit_cents)
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
      SELECT id
      FROM trading_cycles
      WHERE id = $1
        AND user_id = $2
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [trade_cycle_id, userId]
    );

    if (!rows.length) throw new Error('Cycle not found');

    await client.query(
      `
      UPDATE trading_cycles
      SET status = 'STOPPED',
          stopped_early = true,
          completed_at = NOW()
      WHERE id = $1
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





const transferTradeProfits = async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 🔒 Lock all transferable profits
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
      await client.query('COMMIT');
      return res.json({ transferred_cents: 0 });
    }

    const totalProfit = rows.reduce(
      (sum, r) => sum + Number(r.profit_cents),
      0
    );

    // 1️⃣ Credit REAL wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents + $1
      WHERE user_id = $2
        AND type = 'REAL'
      `,
      [totalProfit, userId]
    );

    // 2️⃣ Mark profits as transferred
    await client.query(
      `
      UPDATE trading_cycles
      SET profit_transferred = true
      WHERE id = ANY($1::int[])
      `,
      [rows.map(r => r.id)]
    );

    await client.query('COMMIT');
    return res.json({ transferred_cents: totalProfit });

  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Transfer failed' });
  } finally {
    client.release();
  }
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
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
  `
  SELECT
    COUNT(*) FILTER (WHERE status = 'RUNNING') AS active_cycles,
    COALESCE(SUM(capital_cents), 0) AS total_invested_cents,
    COALESCE(
      SUM(expected_profit_cents)
      FILTER (WHERE status = 'RUNNING'),
      0
    ) AS expected_profit_cents,
    COALESCE(
      SUM(profit_cents)
      FILTER (WHERE status = 'COMPLETED'),
      0
    ) AS realized_profit_cents
  FROM trading_cycles
  WHERE user_id = $1
  `,
  [userId]
);


    const row = rows[0];

    const totalInvested = Number(row.total_invested_cents);
    const realizedProfit = Number(row.realized_profit_cents);

    const roiPercent =
      totalInvested > 0
        ? Number(((realizedProfit / totalInvested) * 100).toFixed(2))
        : 0;

    return res.json({
      active_cycles: Number(row.active_cycles),
      total_invested_cents: totalInvested,
      expected_profit_cents: Number(row.expected_profit_cents),
      realized_profit_cents: realizedProfit,
      roi_percent: roiPercent
    });
  } catch (err) {
    console.error('getTradeOverview error:', err);
    return res.status(500).json({ message: 'Failed to load trade overview' });
  }
};



/**
 * ===============================
 * GET TRADE PROFITS
 * ===============================
 * - Returns completed cycle profits
 * - Excludes zero / forfeited profits
 * - Ordered newest → oldest
 */
const getTradeProfits = async (req, res) => {
  const userId = req.user.id;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      profit_cents,
      completed_at
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






module.exports = {
  startTrade,
  getTradeSummary,
  stopTrade,
  transferTradeProfits,
  completeCycle,
  getTradeHistory,
  getTransferableProfits,
  getTradeOverview,
  getPositions,
  getTradeProfits
};


