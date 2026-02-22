'use strict';

const { creditReferralWallet } = require('./wallet.service');

/**
 * Process referral reward after successful deposit
 * Must be called inside an open transaction
 */
async function processReferralReward(client, userId, depositCents) {

  // 1️⃣ Check if user was referred
  const { rows } = await client.query(
    `
    SELECT referred_by
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (!rows.length) return;

  const referrerId = rows[0].referred_by;

  if (!referrerId) return; // no referrer

  // 2️⃣ Calculate reward (example: 10%)
  const rewardCents = Math.floor(depositCents * 0.10);

  if (rewardCents <= 0) return;

  // 3️⃣ Credit referrer referral wallet
  await creditReferralWallet(
    client,
    referrerId,
    rewardCents,
    'REFERRAL_REWARD'
  );
}

module.exports = { processReferralReward };
