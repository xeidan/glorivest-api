'use strict';

const db = require('../db');

const REWARD_PERCENT = 0.05;

const rewardReferral = async (client, depositId) => {
  const { rows } = await client.query(
    `
    SELECT
      d.id AS deposit_id,
      d.amount_cents,
      d.user_id,
      d.status,
      u.referred_by -- referral_code (TEXT)
    FROM deposits d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = $1
    `,
    [depositId]
  );

  if (!rows.length) return;

  const deposit = rows[0];

  if (deposit.status !== 'SUCCESS') return;
  if (!deposit.referred_by) return;

  const { rows: refRows } = await client.query(
    `
    SELECT id
    FROM users
    WHERE referral_code = $1
    LIMIT 1
    `,
    [deposit.referred_by]
  );

  if (!refRows.length) return;

  const referrerUserId = refRows[0].id;

  const { rowCount } = await client.query(
    `
    SELECT 1
    FROM referral_rewards
    WHERE referred_user_id = $1
    LIMIT 1
    `,
    [deposit.user_id]
  );

  if (rowCount > 0) return;

  const rewardCents = Math.floor(
    Number(deposit.amount_cents) * REWARD_PERCENT
  );

  if (rewardCents <= 0) return;

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
    [referrerUserId, deposit.user_id, deposit.deposit_id, rewardCents]
  );

  const walletRes = await client.query(
    `
    UPDATE wallets
    SET balance_cents = balance_cents + $1
    WHERE user_id = $2 AND type = 'REFERRAL'
    `,
    [rewardCents, referrerUserId]
  );

  if (walletRes.rowCount !== 1) {
    throw new Error('Referral wallet not found');
  }

  await client.query(
    `
    UPDATE users
    SET referral_earnings_cents = referral_earnings_cents + $1
    WHERE id = $2
    `,
    [rewardCents, referrerUserId]
  );

  await client.query(
    `
    UPDATE deposits
    SET referral_rewarded = true
    WHERE id = $1
    `,
    [deposit.deposit_id]
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
    console.error(err);
    return res.status(500).json({ message: 'Failed to confirm deposit' });
  } finally {
    client.release();
  }
};

module.exports = { confirmDeposit };
