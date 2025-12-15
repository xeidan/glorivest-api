const { DEMO, LIVE } = require('../constants/accountModes');
const { getAccountMode } = require('../utils/accountType');

// 🔒 Allow only DEMO accounts
exports.requireDemoAccount = (account) => {
  if (getAccountMode(account) !== DEMO) {
    const err = new Error('Demo account required');
    err.status = 403;
    throw err;
  }
};

// 🔒 Allow only LIVE accounts
exports.requireLiveAccount = (account) => {
  if (getAccountMode(account) !== LIVE) {
    const err = new Error('Live account required');
    err.status = 403;
    throw err;
  }
};

// 🔒 Block demo accounts
exports.blockDemoAccount = (account) => {
  if (getAccountMode(account) === DEMO) {
    const err = new Error('Action not allowed on demo account');
    err.status = 403;
    throw err;
  }
};
