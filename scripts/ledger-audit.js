'use strict';

const { pool } = require('../src/config/database');

(async () => {
  try {
    const q = await pool.query(`
      SELECT
        a.id,
        a.balance_cents,
        COALESCE(SUM(l.amount_cents), 0) AS ledger_sum
      FROM accounts a
      LEFT JOIN ledger l
        ON l.account_id::text = a.id::text
      GROUP BY a.id, a.balance_cents
      HAVING a.balance_cents != COALESCE(SUM(l.amount_cents), 0)
    `);

    if (!q.rows.length) {
      console.log('✅ Ledger is consistent');
      process.exit(0);
    }

    console.error('❌ Ledger mismatch detected:');
    for (const r of q.rows) {
      console.error(
        `Account ${r.id}: balance=${r.balance_cents}, ledger=${r.ledger_sum}`
      );
    }

    process.exit(1);
  } catch (err) {
    console.error('Audit failed:', err);
    process.exit(1);
  }
})();
