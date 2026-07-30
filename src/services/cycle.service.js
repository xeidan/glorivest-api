'use strict';

const { pool } = require('../config/database');

const {
  lockFunds,
  unlockFunds,
  getAccountForUpdate
} = require('./account.service');

const {
  applyWalletDelta
} = require('./wallet.service');

// =====================================================
// START CYCLE
// =====================================================

async function startCycle({
  userId,
  capitalAmount,
  expectedProfit = 0,
  durationMonths
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!capitalAmount || capitalAmount <= 0) {
      throw new Error('Invalid capital amount');
    }

    if (![1, 3, 6].includes(Number(durationMonths))) {
      throw new Error('Invalid duration');
    }

    const account = await getAccountForUpdate(
      client,
      userId,
      'INVESTMENT'
    );

    const running = await client.query(
      `
      SELECT id
      FROM cycles
      WHERE account_id = $1
        AND status = 'RUNNING'
      LIMIT 1
      `,
      [account.id]
    );

    if (running.rows.length) {
      throw new Error('An active cycle already exists');
    }

    await lockFunds(
      client,
      userId,
      Number(capitalAmount)
    );

    const totalDays = Number(durationMonths) * 30;

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        account_id,
        user_id,
        capital_cents,
        expected_profit_cents,
        realized_profit_cents,
        duration_months,
        status,
        started_at,
        ends_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        0,
        $5,
        'RUNNING',
        NOW(),
        NOW() + ($6 || ' days')::interval
      )
      RETURNING *
      `,
      [
        account.id,
        userId,
        Number(capitalAmount),
        Number(expectedProfit),
        Number(durationMonths),
        totalDays
      ]
    );

    await client.query('COMMIT');

    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================
// CURRENT CYCLE
// =====================================================

async function getCurrentCycle(userId) {
  const { rows } = await pool.query(
    `
    SELECT c.*
    FROM cycles c
    JOIN accounts a
      ON a.id = c.account_id
    WHERE a.user_id = $1
      AND a.account_type = 'INVESTMENT'
      AND c.status = 'RUNNING'
    LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

// =====================================================
// ACTIVE CYCLES
// =====================================================

async function getActiveCycles(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      c.*,

      FLOOR(
        EXTRACT(EPOCH FROM (NOW() - c.started_at)) / 86400
      )::int AS elapsed_days,

      GREATEST(
        CEIL(
          EXTRACT(EPOCH FROM (c.ends_at - NOW())) / 86400
        )::int,
        0
      ) AS remaining_days,

      CEIL(
        EXTRACT(EPOCH FROM (c.ends_at - c.started_at)) / 86400
      )::int AS total_days

    FROM cycles c
    JOIN accounts a
      ON a.id = c.account_id

    WHERE a.user_id = $1
      AND a.account_type = 'INVESTMENT'
      AND c.status = 'RUNNING'

    ORDER BY c.started_at ASC
    `,
    [userId]
  );

  return rows;
}

// =====================================================
// COMPLETED CYCLES
// =====================================================

async function getCompletedCycles(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      c.*,

      CASE
        WHEN c.status = 'CANCELLED'
        THEN 'FORFEITED'
        ELSE 'COMPLETED'
      END AS display_status

    FROM cycles c
    JOIN accounts a
      ON a.id = c.account_id

    WHERE a.user_id = $1
      AND a.account_type = 'INVESTMENT'
      AND c.status IN ('COMPLETED','CANCELLED')

    ORDER BY c.completed_at DESC
    `,
    [userId]
  );

  return rows;
}

// =====================================================
// SETTLE COMPLETED CYCLES
// =====================================================

async function settleCompletedCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE status = 'RUNNING'
        AND ends_at <= NOW()
      FOR UPDATE
      `
    );

    for (const cycle of cycles) {
      const profit = Number(cycle.expected_profit_cents || 0);

      await unlockFunds(
        client,
        cycle.user_id,
        Number(cycle.capital_cents)
      );

      if (profit > 0) {
        await applyWalletDelta(
          client,
          cycle.user_id,
          profit,
          'CYCLE_PROFIT',
          {
            refType: 'CYCLE',
            refId: cycle.id,
            idempotencyKey: `cycle:${cycle.id}:profit`,
            reference: `Cycle ${cycle.id} Profit`
          }
        );
      }

      await client.query(
        `
        UPDATE cycles
        SET
          status = 'COMPLETED',
          realized_profit_cents = $1,
          completed_at = NOW()
        WHERE id = $2
        `,
        [
          profit,
          cycle.id
        ]
      );
    }

    await client.query('COMMIT');

    return cycles.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================
// FORFEIT CYCLE
// =====================================================

async function stopCycle({
  userId,
  cycleId
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE id = $1
        AND user_id = $2
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [
        cycleId,
        userId
      ]
    );

    if (!rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = rows[0];

    await unlockFunds(
      client,
      userId,
      Number(cycle.capital_cents)
    );

    const result = await client.query(
      `
      UPDATE cycles
      SET
        status = 'CANCELLED',
        realized_profit_cents = 0,
        completed_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [cycle.id]
    );

    await client.query('COMMIT');

    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  startCycle,
  getCurrentCycle,
  getActiveCycles,
  getCompletedCycles,
  stopCycle,
  settleCompletedCycles
};