// src/utils/accounts.js
'use strict';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function tierSlugToCode(slug) {
  const map = { standard: 'STD', pro: 'PRO', elite: 'ELT' };
  return map[String(slug || '').toLowerCase()] || 'STD';
}

function genAccountCode(userId, seq, tierSlug) {
  const root = 150000 + Number(userId || 0);
  const seqStr = pad2(Number(seq || 1));
  const tcode = tierSlugToCode(tierSlug);
  return `GV${root}-${seqStr}-${tcode}`;
}

module.exports = { genAccountCode, tierSlugToCode };
