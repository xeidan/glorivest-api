'use strict';

const { pool } = require('../config/database');

// --------------------------------------------------
// START CYCLE
// --------------------------------------------------
async function startCycle({
  userId,
  walletId,
  capitalAmount,
  expectedProfit,
  durationMonths
}) {

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    // --------------------------------------------------
    // LOCK WALLET
    // --------------------------------------------------

    const walletRes = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1
      AND user_id = $2
      FOR UPDATE
      `,
      [walletId, userId]
    );

    if (!walletRes.rows.length) {
      throw new Error('Wallet not found');
    }

    const wallet = walletRes.rows[0];

    if (wallet.balance_cents < capitalAmount) {
      throw new Error('Insufficient balance');
    }

    // --------------------------------------------------
    // DEBIT WALLET
    // --------------------------------------------------

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    // --------------------------------------------------
    // CALCULATE RETURN VALUES
    // --------------------------------------------------

    const expectedReturnPct =
      capitalAmount > 0
        ? (Number(expectedProfit) / Number(capitalAmount)) * 100
        : 0;

    const safeReturnPct =
      Number.isFinite(expectedReturnPct)
        ? expectedReturnPct
        : 0;

    const expectedProfitCents =
      Math.round(capitalAmount * safeReturnPct / 100);

    // --------------------------------------------------
    // FIXED CYCLE LENGTH (30 DAY MONTHS)
    // --------------------------------------------------

    const DAYS_PER_MONTH = 30;
    const totalDays = Number(durationMonths) * DAYS_PER_MONTH;

    // --------------------------------------------------
    // CREATE CYCLE
    // --------------------------------------------------

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        user_id,
        wallet_id,
        tier,
        capital_cents,
        expected_return_pct,
        expected_profit_cents,
        duration_months,
        started_at,
        ends_at,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        NOW(),
        NOW() + ($8 || ' days')::interval,
        'RUNNING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        'STANDARD',
        capitalAmount,
        safeReturnPct,
        expectedProfitCents,
        durationMonths,
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


// --------------------------------------------------
// STOP CYCLE (FORFEIT → REFUND CAPITAL ONLY)
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock cycle
    const cycleRes = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE id = $1
        AND user_id = $2
        AND status = 'RUNNING'
      FOR UPDATE
      `,
      [cycleId, userId]
    );

    if (!cycleRes.rows.length) {
      throw new Error('Active cycle not found');
    }

    const cycle = cycleRes.rows[0];

    const isDemo = cycle.wallet_type === 'DEMO';

    // 2. LIVE wallet handling only
    if (!isDemo) {

      // lock wallet
      const walletRes = await client.query(
        `
        SELECT balance_cents
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [cycle.wallet_id]
      );

      if (!walletRes.rows.length) {
        throw new Error('Wallet not found');
      }

      const currentBalance = Number(walletRes.rows[0].balance_cents);

      const refundAmount = Number(cycle.capital_cents);
      const newBalance = currentBalance + refundAmount;

      // IMPORTANT: ledger FIRST (trigger depends on this)
      await client.query(
        `
        INSERT INTO wallet_ledger
        (wallet_id, amount_cents, reason, balance_after_cents, cycle_id)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          cycle.wallet_id,
          refundAmount,
          'CYCLE_FORFEIT_REFUND',
          newBalance,
          cycle.id
        ]
      );

      // THEN update wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [newBalance, cycle.wallet_id]
      );
    }

    // 3. Cancel cycle
    const { rows } = await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED',
          completed_at = NOW(),
          realized_profit_cents = 0
      WHERE id = $1
      RETURNING *
      `,
      [cycle.id]
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




// --------------------------------------------------
// SETTLE COMPLETED CYCLES (CRON, IDEMPOTENT, SAFE)
// --------------------------------------------------
async function settleCompletedCycles() {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock expired running cycles
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

      // Calculate REAL PnL from positions
      const { rows } = await client.query(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN side IN ('LONG','BUY')
              THEN (exit_price - entry_price) * size
            WHEN side IN ('SHORT','SELL')
              THEN (entry_price - exit_price) * size
            ELSE 0
          END
        ),0) AS total_profit
        FROM positions
        WHERE cycle_id = $1
        `,
        [cycle.id]
      );

      const totalProfit = Number(rows[0].total_profit);

      const totalReturnCents =
        cycle.capital_cents + Math.round(totalProfit * 100);

      // Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [totalReturnCents, cycle.wallet_id]
      );

      // Mark cycle completed
      await client.query(
        `
        UPDATE cycles
        SET status = 'COMPLETED',
            completed_at = NOW()
        WHERE id = $1
        `,
        [cycle.id]
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







module.exports = {
  startCycle,
  stopCycle,
  settleCompletedCycles
};
