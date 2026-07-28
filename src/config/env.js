// src/config/env.js
// Central env validation + exported config object
'use strict';

const assert = require('assert');

const get = (k, fallback = undefined) => {
  const v = process.env[k];
  if (v === undefined || v === '') return fallback;
  return v;
};

const NODE_ENV = get('NODE_ENV', 'development');
const DATABASE_URL =
  get('DATABASE_URL') ||
  get('SUPABASE_DATABASE_URL');
const JWT_SECRET = get('JWT_SECRET', 'change-me-in-prod');
const SENDGRID_API_KEY = get('SENDGRID_API_KEY');
const FROM_EMAIL = get('FROM_EMAIL', 'noreply@glorivest.com');
const ENCRYPTION_KEY = get('ENCRYPTION_KEY'); // expected 64 hex chars
const OMNIBUS_TRON_PRIVATE_KEY = get('OMNIBUS_TRON_PRIVATE_KEY', '');
const OMNIBUS_TRON_ADDRESS = get('OMNIBUS_TRON_ADDRESS', '');
const TRON_FULLHOST = get('TRON_FULLHOST', 'https://api.trongrid.io');
const TRONGRID_API_KEY = get('TRONGRID_API_KEY', '');
const FX_NGNUSD = Number(get('FX_NGNUSD', 0));
const LEDGER_CURRENCY = (get('LEDGER_CURRENCY', 'USD') || 'USD').toUpperCase();

const PORT = Number(get('PORT', 3000));

/**
 * Minimal checks. In production you should fail hard on missing critical envs.
 * We assert selectively to avoid taking down local dev without DATABASE_URL set.
 */
if (NODE_ENV === 'production') {
  assert(DATABASE_URL, 'DATABASE_URL is required in production');
  assert(JWT_SECRET && JWT_SECRET !== 'change-me-in-prod', 'JWT_SECRET must be set in production');
  assert(ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64, 'ENCRYPTION_KEY must be 64 hex chars');
}

module.exports = {
  NODE_ENV,
  DATABASE_URL,
  JWT_SECRET,
  SENDGRID_API_KEY,
  FROM_EMAIL,
  ENCRYPTION_KEY,
  OMNIBUS_TRON_PRIVATE_KEY,
  OMNIBUS_TRON_ADDRESS,
  TRON_FULLHOST,
  TRONGRID_API_KEY,
  FX_NGNUSD,
  LEDGER_CURRENCY,
  PORT,
};
