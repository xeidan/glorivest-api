'use strict';

/**
 * CYCLE SERVICE
 *
 * Database source of truth:
 *   accounts
 *
 * Supported cycle accounts:
 *   DEMO
 *   LIVE
 *
 * DEMO:
 *   - Capital is deducted from available balance.
 *   - Capital is placed in locked_balance_cents.
 *   - On completion, capital + profit return to balance.
 *
 * LIVE:
 *   - Capital remains inside balance_cents.
 *   - Capital is committed through locked_balance_cents.
 *   - On completion, capital is unlocked and profit is credited.
 *
 * REFERRAL accounts cannot run cycles.
 */

const { pool } = require('../config/database');

const {
  getAccountForUpdate,
  updateBalance,
  updateLockedBalance,
  credit,
  debit
} = require('./account.service');


// =====================================================
// VALIDATION
// =====================================================

function validateCycleInput({
  capitalAmount,
  expectedProfit,
  durationMonths
}) {
  const capitalCents = Number(capitalAmount);
  const profitCents = Number(expectedProfit || 0);
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

  return {
    capitalCents,
    profitCents,
    duration
  };
}


// =====================================================
// START CYCLE
// =====================================================

async function startCycle({
  userId,
  capitalAmount,
  expectedProfit = 0,
  durationMonths,
  accountType = 'DEMO'
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const normalizedType =
      String(accountType).toUpperCase();

    if (!['DEMO', 'LIVE'].includes(normalizedType)) {
      throw new Error(
        'Cycles are only available for DEMO and LIVE accounts'
      );
    }

    const {
      capitalCents,
      profitCents,
      duration
    } = validateCycleInput({
      capitalAmount,
      expectedProfit,
      durationMonths
    });

    // -------------------------------------------------
    // Get and lock account
    // -------------------------------------------------

    const account = await getAccountForUpdate(
      client,
      userId,
      normalizedType
    );

    if (String(account.status).toUpperCase() !== 'ACTIVE') {
      throw new Error(
        `${normalizedType} account is not active`
      );
    }



    // -------------------------------------------------
    // DEMO
    //
    // Deduct capital from available balance AND
    // move it into locked capital.
    // -------------------------------------------------

    if (normalizedType === 'DEMO') {

      if (currentBalance < capitalCents) {
        throw new Error(
          'Insufficient DEMO balance'
        );
      }

      const newBalance =
        currentBalance - capitalCents;

      const newLocked =
        currentLocked + capitalCents;

      await updateBalance(
        client,
        account.id,
        newBalance
      );

      await updateLockedBalance(
        client,
        account.id,
        newLocked
      );
    }

    // -------------------------------------------------
    // LIVE
    //
    // LIVE balance remains unchanged.
    // Only locked capital increases.
    // -------------------------------------------------

    if (normalizedType === 'LIVE') {

      const available =
        currentBalance - currentLocked;

      if (available < capitalCents) {
        throw new Error(
          'Insufficient available LIVE balance'
        );
      }

      const newLocked =
        currentLocked + capitalCents;

      await updateLockedBalance(
        client,
        account.id,
        newLocked
      );
    }

    // -------------------------------------------------
    // Create cycle
    // -------------------------------------------------

    const totalDays =
      duration * 30;

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

    const newBalance =
      normalizedType === 'DEMO'
        ? currentBalance - capitalCents
        : currentBalance;

    const newLocked =
      currentLocked + capitalCents;

    return {
      ...rows[0],

      account_type:
        normalizedType,

      account_code:
        account.account_code,

      balance_cents:
        newBalance,

      locked_balance_cents:
        newLocked,

      available_balance_cents:
        normalizedType === 'DEMO'
          ? newBalance
          : newBalance - newLocked
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

async function getCurrentCycle(
  userId,
  accountType = 'DEMO'
) {
  const normalizedType =
    String(accountType).toUpperCase();

  const { rows } = await pool.query(
    `
    SELECT
      c.*,
      a.account_code,
      a.account_type,
      a.balance_cents,
      a.locked_balance_cents
    FROM cycles c
    JOIN accounts a
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
      normalizedType
    ]
  );

  return rows[0] || null;
}


// =====================================================
// ACTIVE CYCLES
// =====================================================

async function getActiveCycles(
  userId,
  accountType = 'DEMO'
) {
  const normalizedType =
    String(accountType).toUpperCase();

  const { rows } = await pool.query(
    `
    SELECT
      c.*,
      a.account_code,
      a.account_type,
      a.balance_cents,
      a.locked_balance_cents,

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
      AND a.account_type = $2
      AND c.status = 'RUNNING'

    ORDER BY c.started_at ASC
    `,
    [
      userId,
      normalizedType
    ]
  );

  return rows;
}


// =====================================================
// COMPLETED CYCLES
// =====================================================

async function getCompletedCycles(
  userId,
  accountType = 'DEMO'
) {
  const normalizedType =
    String(accountType).toUpperCase();

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
      AND a.account_type = $2
      AND c.status IN (
        'COMPLETED',
        'CANCELLED'
      )

    ORDER BY
      COALESCE(c.completed_at, c.created_at) DESC
    `,
    [
      userId,
      normalizedType
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

    const { rows: cycles } = await client.query(
      `
      SELECT
        c.*,
        a.account_type,
        a.balance_cents,
        a.locked_balance_cents
      FROM cycles c

      JOIN accounts a
        ON a.id = c.account_id

      WHERE c.status = 'RUNNING'
        AND c.ends_at <= NOW()
        AND a.account_type IN ('DEMO', 'LIVE')

      ORDER BY c.id ASC

      FOR UPDATE OF c
      `
    );

    for (const cycle of cycles) {

      const accountType =
        String(cycle.account_type).toUpperCase();

      const capital =
        Number(cycle.capital_cents);

      const profit =
        Number(cycle.expected_profit_cents || 0);

      const account =
        await getAccountForUpdate(
          client,
          cycle.user_id,
          accountType
        );

      const locked =
        Number(account.locked_balance_cents || 0);

      if (locked < capital) {
        throw new Error(
          `Locked balance is insufficient for cycle ${cycle.id}`
        );
      }

      // ------------------------------------------------
      // Remove this cycle's capital from locked balance
      // ------------------------------------------------

      const newLocked =
        locked - capital;

      await updateLockedBalance(
        client,
        account.id,
        newLocked
      );

      // ------------------------------------------------
      // DEMO
      //
      // Capital was originally deducted.
      // Return capital + profit.
      // ------------------------------------------------

      if (accountType === 'DEMO') {

        await credit(
          client,
          cycle.user_id,
          'DEMO',
          capital + profit
        );
      }

      // ------------------------------------------------
      // LIVE
      //
      // Capital never left balance.
      // Only return the profit.
      // ------------------------------------------------

      if (
        accountType === 'LIVE' &&
        profit > 0
      ) {
        await credit(
          client,
          cycle.user_id,
          'LIVE',
          profit
        );
      }

      // ------------------------------------------------
      // Mark completed
      // ------------------------------------------------

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
// FORFEIT / STOP CYCLE
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
        AND a.account_type IN ('DEMO', 'LIVE')
        AND c.status = 'RUNNING'

      FOR UPDATE
      `,
      [
        cycleId,
        userId
      ]
    );

    if (!rows.length) {
      throw new Error(
        'Active cycle not found'
      );
    }

    const cycle = rows[0];

    const accountType =
      String(cycle.account_type).toUpperCase();

    const capital =
      Number(cycle.capital_cents);

    const account =
      await getAccountForUpdate(
        client,
        userId,
        accountType
      );

    const locked =
      Number(account.locked_balance_cents || 0);

    if (locked < capital) {
      throw new Error(
        'Locked balance is insufficient'
      );
    }

    // ------------------------------------------------
    // Remove capital from locked balance
    // ------------------------------------------------

    await updateLockedBalance(
      client,
      account.id,
      locked - capital
    );

    // ------------------------------------------------
    // DEMO
    //
    // Capital was deducted at cycle start,
    // therefore return it when cycle is stopped.
    //
    // No profit is paid.
    // ------------------------------------------------

    if (accountType === 'DEMO') {

      await credit(
        client,
        userId,
        'DEMO',
        capital
      );
    }

    // ------------------------------------------------
    // LIVE
    //
    // Capital was never deducted, so only unlock it.
    // ------------------------------------------------

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