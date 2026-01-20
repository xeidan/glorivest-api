'use strict';

const { pool } = require('../config/database');

async function completeExpiredCycles() {
  console.log('🔥🔥 completeExpiredCycles RUNNING 🔥🔥');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Lock expired active cycles
    const cyclesRes = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
        AND end_at <= now()
      FOR UPDATE
      `
    );

    console.log(`🔎 Found ${cyclesRes.rowCount} expired active cycles`);

    for (const cycle of cyclesRes.rows) {
      console.log(`➡️ Completing cycle ${cycle.id}`);

      const capital = Number(cycle.capital_amount);
      const profit = Number(cycle.expected_profit);
      const totalPayout = capital + profit;

      // 2️⃣ Ledger: unlock capital
      await client.query(
        `
        INSERT INTO ledger_entries
          (user_id, wallet_id, type, amount_cents, reference_id)
        VALUES
          ($1, $2, 'cycle_unlock', $3, $4)
        `,
        [cycle.user_id, cycle.wallet_id, capital, cycle.id]
      );

      console.log(`🧾 cycle_unlock +${capital} (cycle ${cycle.id})`);

      // 3️⃣ Ledger: profit earned
      await client.query(
        `
        INSERT INTO ledger_entries
          (user_id, wallet_id, type, amount_cents, reference_id)
        VALUES
          ($1, $2, 'cycle_profit', $3, $4)
        `,
        [cycle.user_id, cycle.wallet_id, profit, cycle.id]
      );

      console.log(`🧾 cycle_profit +${profit} (cycle ${cycle.id})`);

      // 4️⃣ Update wallet balance
      await client.query(
        `
        UPDATE wallets w
SET balance_cents = (
  SELECT COALESCE(SUM(amount_cents), 0)
  FROM ledger_entries l
  WHERE l.wallet_id = w.id
)
WHERE w.id = $1;

        WHERE id = $2
        `,
        [totalPayout, cycle.wallet_id]
      );

      console.log(`💰 Wallet ${cycle.wallet_id} +${totalPayout}`);

      // 5️⃣ Mark cycle completed
      await client.query(
        `
        UPDATE investment_cycles
        SET
          status = 'completed',
          accrued_profit = expected_profit,
          updated_at = now()
        WHERE id = $1
        `,
        [cycle.id]
      );

      console.log(`✅ Cycle ${cycle.id} marked completed`);
    }

    await client.query('COMMIT');

    if (cyclesRes.rowCount > 0) {
      console.log(`🎉 Completed ${cyclesRes.rowCount} cycles total`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ completeExpiredCycles error:', err);
  } finally {
    client.release();
  }
}


(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT * FROM trading_cycles
      WHERE status='RUNNING'
        AND completes_at <= NOW()
      FOR UPDATE
      `
    );

    for (const c of rows) {
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = balance_cents + $1
        WHERE user_id=$2 AND type=$3
        `,
        [
          c.capital_cents + c.expected_profit_cents,
          c.user_id,
          c.wallet_type
        ]
      );

      await client.query(
        `
        UPDATE trading_cycles
        SET status='COMPLETED',
            profit_cents=$1,
            completed_at=NOW()
        WHERE id=$2
        `,
        [c.expected_profit_cents, c.id]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
  } finally {
    client.release();
    process.exit();
  }
})();


module.exports = { completeExpiredCycles };
