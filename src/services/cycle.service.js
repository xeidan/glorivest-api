'use strict';

/**
 * Cycle Service
 *
 * Database source of truth:
 *   accounts
 *
 * Trading cycles use:
 *   LIVE accounts only.
 *
 * Financial model:
 *
 * LIVE balance:
 *   Total LIVE capital owned by the user.
 *
 * LIVE locked_balance_cents:
 *   Capital currently committed to running cycles.
 *
 * Available LIVE balance:
 *   balance_cents - locked_balance_cents
 *
 * DEMO accounts are NOT used by this service.
 * REFERRAL accounts are NOT used by this service.
 */

const { pool } = require('../config/database');

const {
  lockFunds,
  unlockFunds,
  applyWalletDelta
} = require('./wallet.service');


// =====================================================
// CONSTANTS
// =====================================================

const LIVE_ACCOUNT_TYPE = 'LIVE';

const VALID_DURATIONS = [1, 3, 6];


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

    // ---------------------------------------------------
    // Validate capital
    // ---------------------------------------------------

    if (
      !Number.isInteger(capitalCents) ||
      capitalCents <= 0
    ) {
      throw new Error('Invalid capital amount');
    }

    // ---------------------------------------------------
    // Validate expected profit
    // ---------------------------------------------------

    if (
      !Number.isInteger(profitCents) ||
      profitCents < 0
    ) {
      throw new Error('Invalid expected profit');
    }

    // ---------------------------------------------------
    // Validate duration
    // ---------------------------------------------------

    if (!VALID_DURATIONS.includes(duration)) {
      throw new Error('Invalid duration');
    }

    // ---------------------------------------------------
    // Get LIVE account and lock it
    // ---------------------------------------------------

    const { rows: accountRows } = await client.query(
      `
      SELECT
        id,
        user_id,
        account_code,
        account_type,
        status,
        balance_cents,
        locked_balance_cents,
        profit_cents
      FROM accounts
      WHERE user_id = $1
        AND account_type = $2
      LIMIT 1
      FOR UPDATE
      `,
      [
        userId,
        LIVE_ACCOUNT_TYPE
      ]
    );

    if (!accountRows.length) {
      throw new Error('LIVE account not found');
    }

    const account = accountRows[0];

    // ---------------------------------------------------
    // Account must be active
    // ---------------------------------------------------

    if (
      String(account.status).toUpperCase() !== 'ACTIVE'
    ) {
      throw new Error('LIVE account is not active');
    }

    // ---------------------------------------------------
    // Only one running cycle per LIVE account
    // ---------------------------------------------------

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
      throw new Error(
        'An active cycle already exists'
      );
    }

    // ---------------------------------------------------
    // Lock requested LIVE capital
    //
    // IMPORTANT:
    // wallet.service expects:
    //
    // lockFunds(
    //   client,
    //   userId,
    //   walletType,
    //   amountCents
    // )
    // ---------------------------------------------------

    const lockResult = await lockFunds(
      client,
      userId,
      LIVE_ACCOUNT_TYPE,
      capitalCents
    );

    // ---------------------------------------------------
    // Calculate cycle duration
    // ---------------------------------------------------

    const totalDays = duration * 30;

    // ---------------------------------------------------
    // Create cycle
    // ---------------------------------------------------

    const { rows } = await client.query(
      `
      INSERT INTO cycles
      (
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
      VALUES
      (
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

    const cycle = rows[0];

    return {
      ...cycle,

      account_type: LIVE_ACCOUNT_TYPE,
      account_code: account.account_code,

      balance_cents:
        Number(lockResult.balance),

      locked_balance_cents:
        Number(lockResult.locked),

      available_balance_cents:
        Number(lockResult.available)
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
      a.account_type,
      a.balance_cents,
      a.locked_balance_cents,
      a.profit_cents

    FROM cycles c

    INNER JOIN accounts a
      ON a.id = c.account_id

    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = $2
      AND c.status = 'RUNNING'

    ORDER BY c.started_at DESC

    LIMIT 1
    `,
    [
      userId,
      LIVE_ACCOUNT_TYPE
    ]
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
      a.balance_cents,
      a.locked_balance_cents,
      a.profit_cents,

      FLOOR(
        EXTRACT(
          EPOCH FROM
          (NOW() - c.started_at)
        ) / 86400
      )::int AS elapsed_days,

      GREATEST(
        CEIL(
          EXTRACT(
            EPOCH FROM
            (c.ends_at - NOW())
          ) / 86400
        )::int,
        0
      ) AS remaining_days,

      CEIL(
        EXTRACT(
          EPOCH FROM
          (c.ends_at - c.started_at)
        ) / 86400
      )::int AS total_days

    FROM cycles c

    INNER JOIN accounts a
      ON a.id = c.account_id

    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = $2
      AND c.status = 'RUNNING'

    ORDER BY c.started_at ASC
    `,
    [
      userId,
      LIVE_ACCOUNT_TYPE
    ]
  );

  return rows;
}


// =====================================================
// COMPLETED / CANCELLED CYCLES
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

        WHEN c.status = 'COMPLETED'
          THEN 'COMPLETED'

        ELSE c.status
      END AS display_status

    FROM cycles c

    INNER JOIN accounts a
      ON a.id = c.account_id

    WHERE c.user_id = $1
      AND a.user_id = $1
      AND a.account_type = $2
      AND c.status IN (
        'COMPLETED',
        'CANCELLED'
      )

    ORDER BY c.completed_at DESC NULLS LAST
    `,
    [
      userId,
      LIVE_ACCOUNT_TYPE
    ]
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

    /*
     * Find every LIVE cycle whose
     * end time has passed.
     */

    const { rows: cycles } = await client.query(
      `
      SELECT
        c.*,
        a.account_code,
        a.account_type,
        a.locked_balance_cents

      FROM cycles c

      INNER JOIN accounts a
        ON a.id = c.account_id

      WHERE c.status = 'RUNNING'
        AND c.ends_at <= NOW()
        AND a.account_type = $1

      FOR UPDATE OF c
      `,
      [LIVE_ACCOUNT_TYPE]
    );

    for (const cycle of cycles) {

      const capitalCents =
        Number(cycle.capital_cents || 0);

      const profitCents =
        Number(cycle.expected_profit_cents || 0);

      // -------------------------------------------------
      // Release locked capital
      // -------------------------------------------------

      await unlockFunds(
        client,
        cycle.user_id,
        LIVE_ACCOUNT_TYPE,
        capitalCents
      );

      // -------------------------------------------------
      // Credit profit to LIVE
      // -------------------------------------------------

      if (profitCents > 0) {

        await applyWalletDelta(
          client,

          cycle.user_id,

          LIVE_ACCOUNT_TYPE,

          profitCents,

          'CYCLE_PROFIT',

          {
            refType: 'CYCLE',
            refId: cycle.id,

            idempotencyKey:
              `cycle:${cycle.id}:profit`,

            reference:
              `Cycle ${cycle.id} Profit`,

            meta: {
              cycle_id: cycle.id,
              account_type: LIVE_ACCOUNT_TYPE,
              capital_cents: capitalCents,
              profit_cents: profitCents
            }
          }
        );
      }

      // -------------------------------------------------
      // Mark cycle completed
      // -------------------------------------------------

      await client.query(
        `
        UPDATE cycles
        SET
          status = 'COMPLETED',
          realized_profit_cents = $1,
          completed_at = NOW(),
          updated_at = NOW()

        WHERE id = $2
        `,
        [
          profitCents,
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
// FORFEIT / STOP CYCLE
// =====================================================

async function stopCycle({
  userId,
  cycleId
}) {

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    // ---------------------------------------------------
    // Lock cycle + verify ownership
    // ---------------------------------------------------

    const { rows } = await client.query(
      `
      SELECT
        c.*,
        a.account_type,
        a.account_code

      FROM cycles c

      INNER JOIN accounts a
        ON a.id = c.account_id

      WHERE c.id = $1
        AND c.user_id = $2
        AND a.user_id = $2
        AND a.account_type = $3
        AND c.status = 'RUNNING'

      FOR UPDATE
      `,
      [
        cycleId,
        userId,
        LIVE_ACCOUNT_TYPE
      ]
    );

    if (!rows.length) {
      throw new Error(
        'Active cycle not found'
      );
    }

    const cycle = rows[0];

    const capitalCents =
      Number(cycle.capital_cents || 0);

    // ---------------------------------------------------
    // Release locked capital
    // ---------------------------------------------------

    await unlockFunds(
      client,
      userId,
      LIVE_ACCOUNT_TYPE,
      capitalCents
    );

    // ---------------------------------------------------
    // Mark cycle forfeited
    //
    // No profit is paid when manually stopped.
    // ---------------------------------------------------

    const result = await client.query(
      `
      UPDATE cycles

      SET
        status = 'CANCELLED',
        realized_profit_cents = 0,
        completed_at = NOW(),
        updated_at = NOW()

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


// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  startCycle,
  getCurrentCycle,
  getActiveCycles,
  getCompletedCycles,
  stopCycle,
  settleCompletedCycles
};