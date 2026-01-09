'use strict';

const { withTx } = require('../config/database');
const { postTransaction } = require('../services/ledger.service');

async function completeExpiredCycles() {
  await withTx(async (client) => {
    // 1. Fetch expired active cycles (FOR UPDATE = lock rows)
    const { rows: cycles } = await client.query(
      `
      SELECT *
      FROM investment_cycles
      WHERE status = 'active'
        AND now() >= end_at
      FOR UPDATE
      `
    );

    for (const cycle of cycles) {
      const { id, user_id, wallet_id, expected_profit } = cycle;

      // 2. Credit wallet (capital already locked earlier)
      await postTransaction(
        {
          userId: user_id,
          walletId: wallet_id,
          type: 'cycle_payout',
          amountCents: Number(expected_profit)
        },
        client
      );

      // 3. Mark cycle completed
      await client.query(
        `
        UPDATE investment_cycles
        SET
          accrued_profit = expected_profit,
          status = 'completed',
          updated_at = now()
        WHERE id = $1
        `,
        [id]
      );
    }

    if (cycles.length > 0) {
      console.log(`Completed ${cycles.length} investment cycles`);
    }
  });
}

module.exports = { completeExpiredCycles };
