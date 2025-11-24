// src/utils/generate.js
'use strict';

const crypto = require('crypto');

exports.referralCode = () => {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
};

exports.depositReference = () => {
  return 'GV' + Math.floor(100000 + Math.random() * 900000);
};

// For account codes: GV{150000+userId}-{NN}
exports.accountCode = (userId, seq) => {
  const base = 150000 + Number(userId);
  return `GV${base}-${String(seq).padStart(2, '0')}`;
};

// Random safe string
exports.randomString = (len = 12) => {
  return crypto.randomBytes(len).toString('hex');
};
