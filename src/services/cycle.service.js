'use strict';

const { pool } = require('../config/database');


// =====================================================
// START NEW CYCLE
// =====================================================

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

    // -------------------------------------------------
    // Lock wallet
    // -------------------------------------------------

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

    // -------------------------------------------------
    // Calculate deployed capital
    // -------------------------------------------------

    const deployedRes = await client.query(
      `
      SELECT COALESCE(SUM(capital_cents),0) AS deployed
      FROM cycles
      WHERE wallet_id = $1
      AND status = 'RUNNING'
      `,
      [walletId]
    );

    const deployed = Number(deployedRes.rows[0].deployed);
    const available = Number(wallet.balance_cents) - deployed;

    if (capitalAmount > available) {
      throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
    }

    // -------------------------------------------------
    // Insert cycle
    // -------------------------------------------------

    const DAYS_PER_MONTH = 30;
    const totalDays = durationMonths * DAYS_PER_MONTH;

    const { rows } = await client.query(
      `
      INSERT INTO cycles (
        user_id,
        wallet_id,
        wallet_type,
        capital_cents,
        expected_profit_cents,
        duration_months,
        started_at,
        ends_at,
        status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        NOW(),
        NOW() + ($7 || ' days')::interval,
        'RUNNING'
      )
      RETURNING *
      `,
      [
        userId,
        walletId,
        wallet.type,
        capitalAmount,
        expectedProfit,
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

      const expectedProfitCents =
        Number(cycle.expected_profit_cents || 0);

      const totalReturnCents =
        Number(cycle.capital_cents) + expectedProfitCents;

      // -------------------------------------------------
      // Lock wallet
      // -------------------------------------------------

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

      const currentBalance =
        Number(walletRes.rows[0].balance_cents);

      const newBalance =
        currentBalance + totalReturnCents;

      // -------------------------------------------------
      // Ledger entry (trigger requires this first)
      // -------------------------------------------------

      await client.query(
        `
        INSERT INTO wallet_ledger
          (wallet_id,
           amount_cents,
           reason,
           balance_after_cents,
           cycle_id)
        VALUES ($1,$2,'CYCLE_SETTLEMENT',$3,$4)
        `,
        [
          cycle.wallet_id,
          totalReturnCents,
          newBalance,
          cycle.id
        ]
      );

      // -------------------------------------------------
      // Update wallet
      // -------------------------------------------------

      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [
          newBalance,
          cycle.wallet_id
        ]
      );

      // -------------------------------------------------
      // Mark cycle completed
      // -------------------------------------------------

      await client.query(
        `
        UPDATE cycles
        SET status = 'COMPLETED',
            completed_at = NOW(),
            realized_profit_cents = $1
        WHERE id = $2
        `,
        [
          expectedProfitCents,
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

async function stopCycle({ userId, cycleId }) {

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    // lock cycle
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

    const currentBalance = Number(walletRes.rows[0].balance_cents);

    const refundAmount = Number(cycle.capital_cents);

    const newBalance = currentBalance + refundAmount;

    // ledger entry
    await client.query(
      `
      INSERT INTO wallet_ledger
      (wallet_id, amount_cents, reason, balance_after_cents, cycle_id)
      VALUES ($1,$2,'CYCLE_FORFEIT_REFUND',$3,$4)
      `,
      [
        cycle.wallet_id,
        refundAmount,
        newBalance,
        cycle.id
      ]
    );

    // update wallet
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [newBalance, cycle.wallet_id]
    );

    // cancel cycle
    await client.query(
      `
      UPDATE cycles
      SET status = 'CANCELLED',
          completed_at = NOW(),
          realized_profit_cents = 0
      WHERE id = $1
      `,
      [cycle.id]
    );

    await client.query('COMMIT');

    return cycle;

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