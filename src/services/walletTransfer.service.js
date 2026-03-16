'use strict';

const { pool } = require('../config/database');

async function getLastLedgerBalance(client, walletId) {
  const { rows } = await client.query(
    `
    SELECT balance_after_cents
    FROM wallet_ledger
    WHERE wallet_id = $1
    ORDER BY id DESC
    LIMIT 1
    `,
    [walletId]
  );

  if (!rows.length) return 0;

  return Number(rows[0].balance_after_cents);
}

async function transferToMainWallet({
  userId,
  amountCents,
  source // 'BOT' | 'REFERRAL'
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error('Invalid transfer amount');
    }

    // ===============================
    // LOCK REAL WALLET
    // ===============================
    const realRes = await client.query(
      `
      SELECT id
      FROM wallets
      WHERE user_id = $1
        AND type = 'REAL'
      FOR UPDATE
      `,
      [userId]
    );

    if (!realRes.rowCount) {
      throw new Error('Main wallet not found');
    }

    const realWalletId = realRes.rows[0].id;

    // ===============================
    // REFERRAL FLOW
    // ===============================
    if (source === 'REFERRAL') {

      const referralRes = await client.query(
        `
        SELECT id
        FROM wallets
        WHERE user_id = $1
          AND type = 'REFERRAL'
        FOR UPDATE
        `,
        [userId]
      );

      if (!referralRes.rowCount) {
        throw new Error('Referral wallet not found');
      }

      const referralWalletId = referralRes.rows[0].id;

      const referralCurrentBalance =
        await getLastLedgerBalance(client, referralWalletId);

      if (referralCurrentBalance < amountCents) {
        throw new Error('Insufficient referral balance');
      }

      const referralNewBalance =
        referralCurrentBalance - amountCents;

      // 1️⃣ Insert debit into ledger FIRST
      await client.query(
`
INSERT INTO wallet_ledger
(wallet_id, amount_cents, reason, balance_after_cents, cycle_id)
VALUES ($1, $2, 'REFERRAL_DEBIT', $3, NULL)
`,
[
  referralWalletId,
  -amountCents,
  referralNewBalance
]
);

      // 2️⃣ Update cached wallet balance
      await client.query(
        `
        UPDATE wallets
        SET balance_cents = $1
        WHERE id = $2
        `,
        [referralNewBalance, referralWalletId]
      );
    }

    // ===============================
    // CREDIT REAL WALLET
    // ===============================
    const realCurrentBalance =
      await getLastLedgerBalance(client, realWalletId);

    const realNewBalance =
      realCurrentBalance + amountCents;

    // 1️⃣ Insert credit into ledger FIRST
    await client.query(
`
INSERT INTO wallet_ledger
(wallet_id, amount_cents, reason, balance_after_cents, cycle_id)
VALUES ($1, $2, $3, $4, NULL)
`,
[
  realWalletId,
  amountCents,
  source === 'REFERRAL'
    ? 'REFERRAL_TRANSFER'
    : 'BOT_TRANSFER',
  realNewBalance
]
);

    // 2️⃣ Update cached wallet balance
    await client.query(
      `
      UPDATE wallets
      SET balance_cents = $1
      WHERE id = $2
      `,
      [realNewBalance, realWalletId]
    );

    await client.query('COMMIT');

    return {
      success: true,
      transferred_cents: amountCents,
      new_balance: realNewBalance
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { transferToMainWallet };
