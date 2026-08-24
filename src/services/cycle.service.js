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

    const capitalCents = Number(capitalAmount);
    const profitCents = Number(expectedProfit);
    const duration = Number(durationMonths);

    if (
      !Number.isInteger(capitalCents) ||
      capitalCents <= 0
    ) {
      throw new Error('Invalid capital amount');
    }

    if (
      !Number.isInteger(profitCents) ||
      profitCents < 0
    ) {
      throw new Error('Invalid expected profit');
    }

    if (![1, 3, 6].includes(duration)) {
      throw new Error('Invalid duration');
    }

    // Cycles always use the user's LIVE account.
    const account = await getAccountForUpdate(
      client,
      userId,
      'LIVE'
    );

    if (account.status !== 'ACTIVE') {
      throw new Error('LIVE account is not active');
    }

    const running = await client.query(
      `
      SELECT id
      FROM cycles
      WHERE account_id = $1
        AND status = 'RUNNING'
      LIMIT 1
      FOR UPDATE
      `,
      [account.id]
    );

    if (running.rows.length) {
      throw new Error('An active cycle already exists');
    }

    // Lock the requested LIVE capital.
    const lockResult = await lockFunds(
      client,
      userId,
      capitalCents
    );

    const totalDays = duration * 30;

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
        capitalCents,
        profitCents,
        duration,
        totalDays
      ]
    );

    await client.query('COMMIT');

    return {
      ...rows[0],
      account_type: account.account_type,
      account_code: account.account_code,
      locked_balance_cents: lockResult.locked,
      available_balance_cents: lockResult.available
    };

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
    SELECT
      c.*,
      a.account_code,
      a.account_type
    FROM cycles c
    JOIN accounts a
      ON a.id = c.account_id
    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = 'LIVE'
      AND c.status = 'RUNNING'
    ORDER BY c.started_at DESC
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
      a.account_code,
      a.account_type,

      FLOOR(
        EXTRACT(
          EPOCH FROM (NOW() - c.started_at)
        ) / 86400
      )::int AS elapsed_days,

      GREATEST(
        CEIL(
          EXTRACT(
            EPOCH FROM (c.ends_at - NOW())
          ) / 86400
        )::int,
        0
      ) AS remaining_days,

      CEIL(
        EXTRACT(
          EPOCH FROM (c.ends_at - c.started_at)
        ) / 86400
      )::int AS total_days

    FROM cycles c

    JOIN accounts a
      ON a.id = c.account_id

    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = 'LIVE'
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
      a.account_code,
      a.account_type,

      CASE
        WHEN c.status = 'CANCELLED'
        THEN 'FORFEITED'
        ELSE 'COMPLETED'
      END AS display_status

    FROM cycles c

    JOIN accounts a
      ON a.id = c.account_id

    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = 'LIVE'
      AND c.status IN (
        'COMPLETED',
        'CANCELLED'
      )

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
      SELECT
        c.*
      FROM cycles c
      JOIN accounts a
        ON a.id = c.account_id
      WHERE c.status = 'RUNNING'
        AND c.ends_at <= NOW()
        AND a.account_type = 'LIVE'
      FOR UPDATE
      `
    );

    for (const cycle of cycles) {
      const profit =
        Number(cycle.expected_profit_cents || 0);

      // Unlock the original LIVE capital.
      await unlockFunds(
        client,
        cycle.user_id,
        Number(cycle.capital_cents)
      );

      // Credit realized profit to LIVE.
      if (profit > 0) {
        await applyWalletDelta(
          client,
          cycle.user_id,
          profit,
          'CYCLE_PROFIT',
          {
            refType: 'CYCLE',
            refId: cycle.id,
            idempotencyKey:
              `cycle:${cycle.id}:profit`,
            reference:
              `Cycle ${cycle.id} Profit`
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
      SELECT
        c.*,
        a.account_type
      FROM cycles c
      JOIN accounts a
        ON a.id = c.account_id
      WHERE c.id = $1
        AND c.user_id = $2
        AND a.user_id = $2
        AND a.account_type = 'LIVE'
        AND c.status = 'RUNNING'
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

    // Release the capital locked by this cycle.
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