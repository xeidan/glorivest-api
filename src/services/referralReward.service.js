'use strict';

const { applyWalletDelta } = require('./wallet.service');

async function processReferralReward(client, userId, depositCents) {
  // 1️⃣ Find who referred this user
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
  if (!referrerId) return;

  // 2️⃣ Calculate reward (example 5%)
  const reward = Math.floor(depositCents * 0.05);

  if (reward <= 0) return;

  // 3️⃣ Credit referral wallet using money engine
  await applyWalletDelta(
    client,
    referrerId,
    'REFERRAL',
    reward,
    'REFERRAL_DEPOSIT_REWARD'
  );
}

module.exports = { processReferralReward };
