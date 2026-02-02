'use strict';

const { pool } = require('../config/database');

// --------------------------------------------------
// START CYCLE
// --------------------------------------------------
'use strict';

const { pool } = require('../config/database');
const requireLiveAccount = require('../utils/requireLiveAccount');

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

    // ❗ LIVE ONLY (REMOVE THIS IF YOU WANT DEMO CYCLES)
    requireLiveAccount(wallet);

    if (Number(wallet.balance_cents) < Number(capitalAmount)) {
      throw new Error('Insufficient balance');
    }

    const startAt = new Date();
    const endAt = new Date(
      startAt.getTime() + durationMonths * 30 * 864e5
    );

    const cycleRes = await client.query(
      `
      INSERT INTO cycles (
        wallet_id,
        capital_amount,
        expected_profit,
        duration_months,
        started_at,
        ends_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING *
      `,
      [
        walletId,
        capitalAmount,
        expectedProfit,
        durationMonths,
        startAt,
        endAt
      ]
    );

    await client.query(
      `
      UPDATE wallets
      SET balance_cents = balance_cents - $1
      WHERE id = $2
      `,
      [capitalAmount, walletId]
    );

    await client.query('COMMIT');
    return cycleRes.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { startCycle };



// --------------------------------------------------
// STOP CYCLE (FORFEIT)
// --------------------------------------------------
async function stopCycle({ userId, cycleId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
      `
      UPDATE cycles
      SET
        status = 'forfeited',
        expected_profit = 0,
        end_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status = 'active'
      RETURNING *
      `,
      [cycleId, userId]
    );

    if (!res.rows.length) {
      throw new Error('Active cycle not found');
    }

    await client.query('COMMIT');
    return res.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  startCycle,
  stopCycle
};
