'use strict';

const db = require('../db');

const REWARD_PERCENT = 0.05;

const rewardReferral = async (client, depositId) => {

  const { rows } = await client.query(
    `
    SELECT
      d.id,
      d.amount_cents,
      d.user_id,
      d.status,
      u.referred_by
    FROM deposits d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = $1
    FOR UPDATE
    `,
    [depositId]
  );

  if (!rows.length) return;

  const deposit = rows[0];

  if (deposit.status !== 'SUCCESS') return;
  // Only reward first successful deposit
const firstCheck = await client.query(
  `
  SELECT COUNT(*)::int AS count
  FROM deposits
  WHERE user_id = $1
    AND status = 'SUCCESS'
  `,
  [deposit.user_id]
);

if (firstCheck.rows[0].count > 1) {
  return;
}
if (Number(deposit.amount_cents) < 10000) {
  return;
}


  if (!deposit.referred_by) return;

  const referrerUserId = deposit.referred_by;

  const existing = await client.query(
    `
    SELECT 1
    FROM referral_rewards
    WHERE deposit_id = $1
    LIMIT 1
    `,
    [deposit.id]
  );

  if (existing.rowCount > 0) return;

  const rewardCents = Math.floor(
    Number(deposit.amount_cents) * REWARD_PERCENT
  );

  if (rewardCents <= 0) return;

  // Lock referral wallet
  const walletRes = await client.query(
    `
    SELECT id, balance_cents
    FROM wallets
    WHERE user_id = $1
      AND type = 'REFERRAL'
    FOR UPDATE
    `,
    [referrerUserId]
  );

  if (!walletRes.rowCount) {
    throw new Error('Referral wallet not found');
  }

  const referralWallet = walletRes.rows[0];
  const newBalance =
    Number(referralWallet.balance_cents) + rewardCents;

  // Record reward row
  await client.query(
    `
    INSERT INTO referral_rewards (
      referrer_user_id,
      referred_user_id,
      deposit_id,
      reward_cents
    )
    VALUES ($1, $2, $3, $4)
    `,
    [
      referrerUserId,
      deposit.user_id,
      deposit.id,
      rewardCents
    ]
  );

  // Ledger credit (trigger updates wallet)
  await client.query(
    `
    INSERT INTO wallet_ledger
      (wallet_id, amount_cents, reason, balance_after_cents)
    VALUES
      ($1, $2, 'REFERRAL_REWARD', $3)
    `,
    [
      referralWallet.id,
      rewardCents,
      newBalance
    ]
  );

  await client.query(
    `
    UPDATE deposits
    SET referral_rewarded = true
    WHERE id = $1
    `,
    [deposit.id]
  );
};

const confirmDeposit = async (req, res) => {
  const { depositId } = req.params;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT id, status
      FROM deposits
      WHERE id = $1
      FOR UPDATE
      `,
      [depositId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Deposit not found' });
    }

    if (rows[0].status === 'SUCCESS') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Deposit already confirmed' });
    }

    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS'
      WHERE id = $1
      `,
      [depositId]
    );

    await rewardReferral(client, depositId);

    await client.query('COMMIT');

    return res.json({ message: 'Deposit confirmed successfully' });

  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to confirm deposit' });
  } finally {
    client.release();
  }
};

module.exports = { confirmDeposit };
