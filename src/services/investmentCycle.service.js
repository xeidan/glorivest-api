'use strict';

const { pool, withTx } = require('../config/database');

function getPlanPercent(capital, duration) {
  if (capital >= 50 && capital <= 499) {
    if (duration === 30) return 15;
    if (duration === 90) return 50;
    if (duration === 180) return 110;
  }

  if (capital >= 500 && capital <= 4999) {
    if (duration === 30) return 17;
    if (duration === 90) return 60;
    if (duration === 180) return 135;
  }

  if (capital >= 5000) {
    if (duration === 30) return 20;
    if (duration === 90) return 70;
    if (duration === 180) return 150;
  }

  throw new Error('Invalid plan configuration');
}

async function startCycle({ userId, walletId, principalAmount, durationDays }) {
  return withTx(async (client) => {

    const walletRes = await client.query(
      `SELECT id FROM wallets WHERE id = $1 AND user_id = $2`,
      [walletId, userId]
    );

    if (!walletRes.rowCount) {
      throw new Error('Wallet not found');
    }

    const activeRes = await client.query(
      `SELECT id FROM investment_cycles
       WHERE wallet_id = $1 AND status = 'active'`,
      [walletId]
    );

    if (activeRes.rowCount) {
      throw new Error('Active cycle already exists');
    }

    const percent = getPlanPercent(principalAmount, durationDays);
    const expectedProfit = principalAmount * (percent / 100);

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const insertRes = await client.query(
      `
      INSERT INTO investment_cycles
        (
          user_id,
          wallet_id,
          principal_amount,
          duration_days,
          plan_percent,
          start_at,
          end_at,
          expected_profit,
          status,
          trades_generated
        )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',false)
      RETURNING *
      `,
      [
        userId,
        walletId,
        principalAmount,
        durationDays,
        percent,
        startAt,
        endAt,
        expectedProfit
      ]
    );

    return insertRes.rows[0];
  });
}

async function stopCycle({ userId, walletId }) {
  const res = await pool.query(
    `
    UPDATE investment_cycles
    SET status = 'forfeited',
        updated_at = now()
    WHERE wallet_id = $1
      AND user_id = $2
      AND status = 'active'
    RETURNING *
    `,
    [walletId, userId]
  );

  if (!res.rowCount) {
    throw new Error('No active cycle to stop');
  }

  return res.rows[0];
}

async function getCurrentCycle({ userId, walletId }) {
  const res = await pool.query(
    `
    SELECT *
    FROM investment_cycles
    WHERE user_id = $1
      AND wallet_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId, walletId]
  );

  if (!res.rows.length) return null;

  const cycle = res.rows[0];

  // Profit now comes from positions table
  const profitRes = await pool.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN side IN ('BUY','LONG')
          THEN (exit_price - entry_price) * size
        WHEN side IN ('SELL','SHORT')
          THEN (entry_price - exit_price) * size
        ELSE 0
      END
    ),0) AS total_pnl
    FROM positions
    WHERE cycle_id = $1
      AND status = 'CLOSED'
    `,
    [cycle.id]
  );

  const accrued = Number(profitRes.rows[0].total_pnl);
  const expected = Number(cycle.expected_profit);

  const progress =
    expected === 0 ? 0 : Math.min(100, (accrued / expected) * 100);

  return {
    ...cycle,
    accrued_profit: accrued,
    progress_percent: Number(progress.toFixed(2)),
  };
}


async function settleCycleIfCompleted(cycle) {
  if (!cycle || cycle.status !== 'active') {
    return cycle;
  }

  const now = new Date();
  const endAt = new Date(cycle.end_at);

  if (now < endAt) {
    return cycle;
  }

  return withTx(async (client) => {

    // Lock cycle row to prevent double settlement
    const lockRes = await client.query(
      `SELECT * FROM investment_cycles
       WHERE id = $1
       FOR UPDATE`,
      [cycle.id]
    );

    const lockedCycle = lockRes.rows[0];

    if (!lockedCycle || lockedCycle.status !== 'active') {
      return lockedCycle;
    }

    // Compute real realized profit
    const pnlRes = await client.query(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN side IN ('BUY','LONG')
            THEN (exit_price - entry_price) * size
          WHEN side IN ('SELL','SHORT')
            THEN (entry_price - exit_price) * size
          ELSE 0
        END
      ),0) AS total_pnl
      FROM positions
      WHERE cycle_id = $1
        AND status = 'CLOSED'
      `,
      [cycle.id]
    );

    const realizedProfit = Number(pnlRes.rows[0].total_pnl);

    const payout =
      Number(lockedCycle.principal_amount) + realizedProfit;

    // Credit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance = balance + $1,
          updated_at = now()
      WHERE id = $2
      `,
      [payout, lockedCycle.wallet_id]
    );

    // Mark cycle completed
    const updateRes = await client.query(
      `
      UPDATE investment_cycles
      SET status = 'completed',
          accrued_profit = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING *
      `,
      [realizedProfit, lockedCycle.id]
    );

    return updateRes.rows[0];
  });
}



module.exports = {
  startCycle,
  stopCycle,
  getCurrentCycle,
  settleCycleIfCompleted
};
