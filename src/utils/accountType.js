const { DEMO, LIVE } = require('../constants/accountModes');

exports.getAccountMode = function (account) {
  if (!account || !account.account_type) return null;

  const t = String(account.account_type).toLowerCase();

  if (t === DEMO) return DEMO;
  if (t === LIVE) return LIVE;

  return null;
};
