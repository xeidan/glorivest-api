requireLiveAccount(account);

// debit referral
await postTransaction({
  userId,
  accountId: referralAccountId,
  type: 'referral_transfer',
  amountCents: -amount
}, db);

// credit main
await postTransaction({
  userId,
  accountId: mainAccountId,
  type: 'referral_transfer',
  amountCents: amount
}, db);
