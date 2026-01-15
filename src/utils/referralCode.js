const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateReferralCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

module.exports = { generateReferralCode };
