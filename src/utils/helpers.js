// src/utils/helpers.js
'use strict';

// Format amount safely
exports.formatAmount = (x) => {
  return Number(Number(x || 0).toFixed(6));
};

// Ensure required fields exist
exports.requireFields = (body, fields = []) => {
  const missing = [];
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      missing.push(f);
    }
  }
  return missing;
};

// Convert DB row snake_case → camelCase (optional)
exports.toCamel = (obj) => {
  if (!obj) return obj;

  const out = {};
  for (const k in obj) {
    const camel = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    out[camel] = obj[k];
  }
  return out;
};

// Sleep helper (workers)
exports.sleep = (ms) => new Promise(res => setTimeout(res, ms));
