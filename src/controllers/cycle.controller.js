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

    const walletRes = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE id = $1 AND user_id = $2
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

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    const expectedReturnPct =
      capitalAmount > 0
        ? (Number(expectedProfit) / Number(capitalAmount)) * 100
        : 0;

    // 🔒 FIXED DAYS — NO CALENDAR MONTHS
    const DAYS_PER_MONTH = 30;
    const totalDays = Number(durationMonths) * DAYS_PER_MONTH;

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        user_id,
        wallet_id,
        tier,
        capital_cents,
        expected_return_pct,
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
        NOW(),
        NOW() + ($7 || ' days')::interval,
        'RUNNING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        'STANDARD',
        capitalAmount,
        expectedReturnPct,
        durationMonths, // kept for reference
        totalDays       // 👈 THIS is what ends_at uses
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

    // DEMO cycles do NOT affect wallets
    const isDemo = cycle.wallet_type === 'DEMO';

    // 2. Lock wallet (LIVE only)
    let wallet;
    if (!isDemo) {
      const walletRes = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE id = $1
        FOR UPDATE
        `,
        [cycle.wallet_id]
      );

      if (!walletRes.rows.length) {
        throw new Error('Wallet not found');
      }

      wallet = walletRes.rows[0];

      // 3. Refund capital
      const newBalance = wallet.balance_cents + cycle.capital_cents;

      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1
        WHERE id = $2
        `,
        [newBalance, wallet.id]
      );

      // 4. Ledger entry
      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id, cycle_id, type, reason, amount_cents, balance_after_cents)
        VALUES
          ($1, $2, 'CREDIT', 'CYCLE_FORFEIT_REFUND', $3, $4)
        `,
        [
          wallet.id,
          cycle.id,
          cycle.capital_cents,
          newBalance
        ]
      );
    }

    // 5. Cancel cycle
    const { rows } = await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED',
          completed_at = NOW()
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
// SETTLE COMPLETED CYCLES (CRON, IDEMPOTENT)
// --------------------------------------------------
// --------------------------------------------------
// SETTLE COMPLETED CYCLES (CRON, IDEMPOTENT)
// --------------------------------------------------
async function settleCompletedCycles() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /**
     * 1. Lock ONLY eligible cycles
     *    - RUNNING
     *    - expired
     *    - SKIP LOCKED guarantees idempotency
     */
    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM cycles
      WHERE status = 'RUNNING'
        AND ends_at <= NOW()
      FOR UPDATE SKIP LOCKED
      `
    );

    for (const cycle of cycles) {

  const profitCents = Math.floor(
    cycle.capital_cents * (Number(cycle.expected_return_pct) / 100)
  );

  // 1️⃣ Finalize cycle FIRST (idempotent guard)
  const { rowCount } = await client.query(
    `
    UPDATE cycles
    SET status = 'COMPLETED',
        completed_at = NOW(),
        realized_profit_cents = $2
    WHERE id = $1
    `,
    [cycle.id, profitCents]
  );

  // If already completed → skip safely
  if (rowCount === 0) continue;

  // 2️⃣ Resolve wallet
  const walletRes = await client.query(
    `SELECT id, type, balance_cents FROM wallets WHERE id = $1 FOR UPDATE`,
    [cycle.wallet_id]
  );

  if (!walletRes.rows.length) continue;

  const wallet = walletRes.rows[0];
  if (wallet.type === 'DEMO') continue;

  const payoutCents = cycle.capital_cents + profitCents;
  const newBalance = wallet.balance_cents + payoutCents;

  // 3️⃣ Credit wallet
  await client.query(
    `UPDATE wallets SET balance_cents = $1 WHERE id = $2`,
    [newBalance, wallet.id]
  );

  // 4️⃣ Ledger
  await client.query(
    `
    INSERT INTO wallet_ledger
      (wallet_id, cycle_id, reason, amount_cents)
    VALUES
      ($1, $2, 'CYCLE_COMPLETED_PAYOUT', $3)
    `,
    [wallet.id, cycle.id, payoutCents]
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
