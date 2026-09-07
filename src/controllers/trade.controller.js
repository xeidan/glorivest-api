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
// ACCOUNT TYPE
// =====================================================

function resolveAccountType(value) {
  const type = String(value || '').toUpperCase();

  /*
   * Frontend may still send REAL.
   * Database uses LIVE.
   */
  if (type === 'REAL') {
    return 'LIVE';
  }

  if (type === 'LIVE') {
    return 'LIVE';
  }

  if (type === 'DEMO') {
    return 'DEMO';
  }

  return null;
}


function getRequestedAccountType(req) {
  return resolveAccountType(
    req.query.account_type ||
    req.query.wallet_type ||
    req.body?.account_type ||
    req.body?.wallet_type
  );
}


// =====================================================
// START TRADE
// =====================================================

const startTrade = async (req, res) => {
  const userId = req.user.id;

  const {
    amount_cents,
    wallet_type,
    account_type,
    duration_months
  } = req.body;

  const selectedType = resolveAccountType(
    account_type || wallet_type
  );

  const capital = Number(amount_cents);
  const duration = Number(duration_months);

  // ---------------------------------------------------
  // Validate account type
  // ---------------------------------------------------

  if (!selectedType) {
    return res.status(400).json({
      message: 'Invalid account type'
    });
  }

  /*
   * REFERRAL accounts can receive referral earnings
   * but cannot be used for trading cycles.
   */
  if (selectedType === 'REFERRAL') {
    return res.status(400).json({
      message: 'Referral account cannot be used for trading'
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
  // START CYCLE
  // ---------------------------------------------------

  try {
    const cycle = await startCycle({
      userId,
      accountType: selectedType,
      capitalAmount: capital,
      expectedProfit: expectedProfitCents,
      durationMonths: duration
    });

    return res.status(201).json({
      message: `${selectedType} trading cycle started`,
      cycle: {
        ...cycle,
        tier,
        roi_percent: roiPercent,
        account_type: selectedType
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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    if (accountType === 'REFERRAL') {
      return res.json({
        cycle: null
      });
    }

    const cycle = await getCurrentCycle(
      req.user.id,
      accountType
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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    if (accountType === 'REFERRAL') {
      return res.json([]);
    }

    const cycles = await getActiveCycles(
      req.user.id,
      accountType
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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    if (accountType === 'REFERRAL') {
      return res.json([]);
    }

    const cycles = await getCompletedCycles(
      req.user.id,
      accountType
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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    if (accountType === 'REFERRAL') {
      return res.json({
        total_active_capital_cents: 0,
        active_cycle_count: 0,
        total_realized_profit_cents: 0
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE c.status = 'RUNNING'
        ) AS active_cycle_count,

        COALESCE(
          SUM(c.capital_cents)
          FILTER (
            WHERE c.status = 'RUNNING'
          ),
          0
        ) AS total_active_capital_cents,

        COALESCE(
          SUM(c.realized_profit_cents)
          FILTER (
            WHERE c.status = 'COMPLETED'
          ),
          0
        ) AS total_realized_profit_cents

      FROM cycles c

      JOIN accounts a
        ON a.id = c.account_id

      WHERE c.user_id = $1
        AND a.user_id = $1
        AND a.account_type = $2
      `,
      [
        req.user.id,
        accountType
      ]
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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    if (accountType === 'REFERRAL') {
      return res.json({
        active_cycles: 0,
        total_invested_cents: 0,
        expected_profit_cents: 0,
        realized_profit_cents: 0,
        roi_percent: 0
      });
    }

    const { rows } = await pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE c.status = 'RUNNING'
        ) AS active_cycles,

        COALESCE(
          SUM(c.capital_cents)
          FILTER (
            WHERE c.status = 'RUNNING'
          ),
          0
        ) AS total_invested_cents,

        COALESCE(
          SUM(c.expected_profit_cents)
          FILTER (
            WHERE c.status = 'RUNNING'
          ),
          0
        ) AS expected_profit_cents,

        COALESCE(
          SUM(c.realized_profit_cents)
          FILTER (
            WHERE c.status = 'COMPLETED'
          ),
          0
        ) AS realized_profit_cents

      FROM cycles c

      JOIN accounts a
        ON a.id = c.account_id

      WHERE c.user_id = $1
        AND a.user_id = $1
        AND a.account_type = $2
      `,
      [
        req.user.id,
        accountType
      ]
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
      account_type: accountType,

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

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.cycle_id,
        p.symbol,
        p.side,
        p.volume,
        p.entry_price,
        p.exit_price,
        p.status,
        p.pnl_cents,
        p.opened_at,
        p.closed_at

      FROM bot_positions p

      JOIN cycles c
        ON c.id = p.cycle_id

      JOIN accounts a
        ON a.id = c.account_id

      WHERE p.user_id = $1
        AND c.user_id = $1
        AND a.user_id = $1
        AND a.account_type = $2

      ORDER BY p.opened_at DESC
      `,
      [
        req.user.id,
        accountType
      ]
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

const getTransferableProfits = async (req, res) => {
  return res.json([]);
};


// =====================================================
// GET TRADE PROFITS
// =====================================================

const getTradeProfits = async (req, res) => {

  try {

    const accountType =
      getRequestedAccountType(req);

    if (!accountType) {
      return res.status(400).json({
        message: 'account_type is required'
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.realized_profit_cents AS profit_cents,
        c.completed_at

      FROM cycles c

      JOIN accounts a
        ON a.id = c.account_id

      WHERE c.user_id = $1
        AND a.user_id = $1
        AND a.account_type = $2
        AND c.status = 'COMPLETED'
        AND c.realized_profit_cents > 0

      ORDER BY c.completed_at ASC
      `,
      [
        req.user.id,
        accountType
      ]
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

const transferTradeProfits = async (req, res) => {
  return res.json({
    transferred_cents: 0,
    message:
      'Cycle profits are credited to the trading account automatically'
  });
};


// =====================================================
// COMPLETE CYCLE
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