'use strict';

const { pool } = require('../config/database');

const {
  startCycle,
  getCurrentCycle,
  getActiveCycles,
  getCompletedCycles,
  stopCycle
} = require('../services/cycle.service');

const {
  getTier,
  getRoiPercent
} = require('../utils/roi');


// =====================================================
// START TRADE
// =====================================================

const startTrade = async (req, res) => {
  const userId = req.user.id;

  const {
    amount_cents,
    wallet_type,
    duration_months
  } = req.body;

  const capital = Number(amount_cents);
  const duration = Number(duration_months);

  // ---------------------------------------------------
  // Validate wallet type
  //
  // Current system supports:
  //   LIVE
  //   DEMO
  //   REFERRAL
  //
  // Trading cycles currently use LIVE only.
  // ---------------------------------------------------

  if (!['LIVE', 'DEMO'].includes(wallet_type)) {
    return res.status(400).json({
      message: 'Invalid wallet type'
    });
  }

  /*
   * The cycle engine currently operates on LIVE.
   *
   * DEMO trading should only be enabled once the cycle
   * engine is explicitly designed to use DEMO accounts.
   */
  if (wallet_type !== 'LIVE') {
    return res.status(400).json({
      message: 'Trading cycles currently use the LIVE account'
    });
  }

  // ---------------------------------------------------
  // Validate capital
  // ---------------------------------------------------

  if (
    !Number.isInteger(capital) ||
    capital <= 0
  ) {
    return res.status(400).json({
      message: 'Invalid amount'
    });
  }

  // ---------------------------------------------------
  // Validate duration
  // ---------------------------------------------------

  if (![1, 3, 6].includes(duration)) {
    return res.status(400).json({
      message: 'Invalid duration'
    });
  }

  // ---------------------------------------------------
  // Determine tier + ROI
  // ---------------------------------------------------

  let tier;
  let roiPercent;

  try {
    tier = getTier(capital);

    roiPercent = getRoiPercent(
      tier,
      duration
    );

  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }

  const expectedProfitCents = Math.floor(
    capital * (roiPercent / 100)
  );

  // ---------------------------------------------------
  // Start cycle through cycle service
  // ---------------------------------------------------

  try {
    const cycle = await startCycle({
      userId,
      capitalAmount: capital,
      expectedProfit: expectedProfitCents,
      durationMonths: duration
    });

    return res.status(201).json({
      message: 'Trading cycle started',
      cycle: {
        ...cycle,
        tier,
        roi_percent: roiPercent
      }
    });

  } catch (err) {

    console.error(
      'startTrade error:',
      err
    );

    return res.status(400).json({
      message: err.message
    });
  }
};


// =====================================================
// GET CURRENT TRADE
// =====================================================

const getCurrentTrade = async (req, res) => {
  try {
    const cycle = await getCurrentCycle(
      req.user.id
    );

    return res.json({
      cycle
    });

  } catch (err) {

    console.error(
      'getCurrentTrade error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load current trade'
    });
  }
};


// =====================================================
// GET ACTIVE TRADE CYCLES
// =====================================================

const getActiveTrades = async (req, res) => {
  try {
    const cycles = await getActiveCycles(
      req.user.id
    );

    return res.json(cycles);

  } catch (err) {

    console.error(
      'getActiveTrades error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load active trades'
    });
  }
};


// =====================================================
// GET TRADE HISTORY
// =====================================================

const getTradeHistory = async (req, res) => {
  try {
    const cycles = await getCompletedCycles(
      req.user.id
    );

    return res.json(cycles);

  } catch (err) {

    console.error(
      'getTradeHistory error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load trade history'
    });
  }
};


// =====================================================
// STOP TRADE CYCLE
// =====================================================

const stopTrade = async (req, res) => {
  const userId = req.user.id;

  const cycleId = Number(
    req.body.cycle_id ??
    req.body.trade_cycle_id
  );

  if (
    !Number.isInteger(cycleId) ||
    cycleId <= 0
  ) {
    return res.status(400).json({
      message: 'Invalid cycle ID'
    });
  }

  try {

    const cycle = await stopCycle({
      userId,
      cycleId
    });

    return res.json({
      message: 'Cycle stopped',
      cycle
    });

  } catch (err) {

    console.error(
      'stopTrade error:',
      err
    );

    return res.status(400).json({
      message: err.message
    });
  }
};


// =====================================================
// GET TRADE SUMMARY
// =====================================================

const getTradeSummary = async (req, res) => {
  try {

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'RUNNING'
        ) AS active_cycle_count,

        COALESCE(
          SUM(capital_cents)
          FILTER (
            WHERE status = 'RUNNING'
          ),
          0
        ) AS total_active_capital_cents,

        COALESCE(
          SUM(realized_profit_cents)
          FILTER (
            WHERE status = 'COMPLETED'
          ),
          0
        ) AS total_realized_profit_cents

      FROM cycles

      WHERE user_id = $1
      `,
      [req.user.id]
    );

    const row = rows[0];

    return res.json({
      total_active_capital_cents:
        Number(row.total_active_capital_cents),

      active_cycle_count:
        Number(row.active_cycle_count),

      total_realized_profit_cents:
        Number(row.total_realized_profit_cents)
    });

  } catch (err) {

    console.error(
      'getTradeSummary error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load trade summary'
    });
  }
};


// =====================================================
// GET TRADE OVERVIEW
// =====================================================

const getTradeOverview = async (req, res) => {
  try {

    const { rows } = await pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE status = 'RUNNING'
        ) AS active_cycles,

        COALESCE(
          SUM(capital_cents)
          FILTER (
            WHERE status = 'RUNNING'
          ),
          0
        ) AS total_invested_cents,

        COALESCE(
          SUM(expected_profit_cents)
          FILTER (
            WHERE status = 'RUNNING'
          ),
          0
        ) AS expected_profit_cents,

        COALESCE(
          SUM(realized_profit_cents)
          FILTER (
            WHERE status = 'COMPLETED'
          ),
          0
        ) AS realized_profit_cents

      FROM cycles

      WHERE user_id = $1
      `,
      [req.user.id]
    );

    const row = rows[0];

    const totalInvested =
      Number(row.total_invested_cents);

    const expectedProfit =
      Number(row.expected_profit_cents);

    const realizedProfit =
      Number(row.realized_profit_cents);

    const roiPercent =
      totalInvested > 0
        ? Number(
            (
              (realizedProfit / totalInvested) *
              100
            ).toFixed(2)
          )
        : 0;

    return res.json({
      active_cycles:
        Number(row.active_cycles),

      total_invested_cents:
        totalInvested,

      expected_profit_cents:
        expectedProfit,

      realized_profit_cents:
        realizedProfit,

      roi_percent:
        roiPercent
    });

  } catch (err) {

    console.error(
      'getTradeOverview error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load trade overview'
    });
  }
};


// =====================================================
// GET POSITIONS
// =====================================================

const getPositions = async (req, res) => {
  try {

    const { rows } = await pool.query(
      `
      SELECT
        id,
        cycle_id,
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
      [req.user.id]
    );

    return res.json({
      positions: rows
    });

  } catch (err) {

    console.error(
      'getPositions error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load positions'
    });
  }
};


// =====================================================
// GET TRANSFERABLE PROFITS
// =====================================================
//
// IMPORTANT:
// Profit is now credited to LIVE automatically when
// settleCompletedCycles() runs.
//
// Therefore there is NO separate profit-transfer
// operation anymore.
//
// This endpoint is retained only for frontend
// compatibility and reports zero transferable profit.
// =====================================================

const getTransferableProfits = async (req, res) => {
  return res.json([]);
};


// =====================================================
// GET TRADE PROFITS
// =====================================================

const getTradeProfits = async (req, res) => {

  try {

    const { rows } = await pool.query(
      `
      SELECT
        id,
        realized_profit_cents AS profit_cents,
        completed_at

      FROM cycles

      WHERE user_id = $1
        AND status = 'COMPLETED'
        AND realized_profit_cents > 0

      ORDER BY completed_at ASC
      `,
      [req.user.id]
    );

    return res.json(rows);

  } catch (err) {

    console.error(
      'getTradeProfits error:',
      err
    );

    return res.status(500).json({
      message: 'Failed to load trade profits'
    });
  }
};


// =====================================================
// TRANSFER TRADE PROFITS
// =====================================================
//
// Deprecated under the new financial model.
//
// settleCompletedCycles() already credits profits
// directly into LIVE.
//
// We return zero instead of performing a second
// transfer and risking double-crediting.
// =====================================================

const transferTradeProfits = async (req, res) => {
  return res.json({
    transferred_cents: 0,
    message: 'Cycle profits are credited to LIVE automatically'
  });
};


// =====================================================
// COMPLETE CYCLE
// =====================================================
//
// Completion is now handled by cycle.service.js.
//
// This controller intentionally does not expose
// client-side cycle completion.
// =====================================================

const completeCycle = async () => {
  throw new Error(
    'Cycle completion is system-controlled'
  );
};


// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  startTrade,
  getCurrentTrade,
  getActiveTrades,
  getTradeHistory,
  stopTrade,

  getTradeSummary,
  getTradeOverview,

  getPositions,

  getTransferableProfits,
  getTradeProfits,

  transferTradeProfits,
  completeCycle
};