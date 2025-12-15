requireLiveAccount(account);

await postTransaction({
  userId,
  accountId,
  type: 'cycle_lock',
  amountCents: -capital
}, db);


await postTransaction({
  userId,
  accountId,
  type: 'cycle_payout',
  amountCents: capital + profit
}, db);
