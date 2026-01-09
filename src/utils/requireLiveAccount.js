'use strict';

module.exports = function requireLiveAccount(account) {
  if (!account) {
    const err = new Error('Account not found');
    err.statusCode = 404;
    throw err;
  }

  if (!account.status) {
    const err = new Error('Account status missing');
    err.statusCode = 500;
    throw err;
  }

  if (account.status !== 'active') {
    const err = new Error('Account is not active');
    err.statusCode = 403;
    throw err;
  }

  return true;
};
