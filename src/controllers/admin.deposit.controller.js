'use strict';

const REWARD_PERCENT = 0.05;

/**
 * Reward referrer on FIRST approved deposit only
 * Must be called inside the same transaction that approves the deposit
 */
const rewardReferral = async (client, depositId) => {
  const { rows } = await client.query(
    `
    SELECT d.id, d.amount_cents, d.referral_rewarded,
           u.id AS user_id, u.referred_by, u.first_deposit_done
    FROM deposits d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = $1
    FOR UPDATE
    `,
    [depositId]
  );

  if (!rows.length) return;

  const deposit = rows[0];

  if (
    deposit.referral_rewarded ||
    deposit.first_deposit_done ||
    !deposit.referred_by
  ) {
    return;
  }

  const rewardCents = Math.floor(deposit.amount_cents * REWARD_PERCENT);

  await client.query(
    `
    UPDATE wallets
    SET balance_cents = balance_cents + $1
    WHERE user_id = $2 AND type = 'REFERRAL'
    `,
    [rewardCents, deposit.referred_by]
  );

  await client.query(
    `
    UPDATE users
    SET first_deposit_done = true
    WHERE id = $1
    `,
    [deposit.user_id]
  );

  await client.query(
    `
    UPDATE deposits
    SET referral_rewarded = true
    WHERE id = $1
    `,
    [depositId]
  );
};

module.exports = {
  rewardReferral
};
