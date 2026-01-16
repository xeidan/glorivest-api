// admin.deposit.controller.js
'use strict';

const REWARD_PERCENT = 0.05;

const rewardReferral = async (client, depositId) => {
  // Lock deposit + user
  const { rows } = await client.query(
    `
    SELECT 
      d.id,
      d.amount_cents,
      d.referral_rewarded,
      u.id AS user_id,
      u.referred_by,
      u.first_deposit_done
    FROM deposits d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = $1
    FOR UPDATE
    `,
    [depositId]
  );

  if (!rows.length) return;

  const deposit = rows[0];

  // Guards
  if (
    !deposit.referred_by ||          // no referrer
    deposit.first_deposit_done ||    // already rewarded
    deposit.referral_rewarded
  ) {
    return;
  }

  // 1️⃣ Resolve referral_code → referrer user.id
  const { rows: refRows } = await client.query(
    `
    SELECT id
    FROM users
    WHERE referral_code = $1
    LIMIT 1
    `,
    [deposit.referred_by] // TEXT → TEXT
  );

  if (!refRows.length) return;

  const referrerId = refRows[0].id;

  // 2️⃣ Calculate reward
  const rewardCents = Math.floor(
    Number(deposit.amount_cents) * REWARD_PERCENT
  );

  // 3️⃣ Credit referrer wallet
  await client.query(
    `
    UPDATE wallets
    SET balance_cents = balance_cents + $1
    WHERE user_id = $2
      AND type = 'REFERRAL'
    `,
    [rewardCents, referrerId]
  );

  // 4️⃣ Mark flags
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

module.exports = { rewardReferral };
