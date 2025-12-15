// src/controllers/account.controller.js
'use strict';

const pool = require('../config/database').pool;
const { postTransaction } = require('../services/ledger.service');


/** Map slug -> 3-letter code */
function tierCodeFromSlug(slug) {
  const map = { standard: 'STD', pro: 'PRO', elite: 'ELT' };
  return (map[slug] || (slug || '').slice(0,3).toUpperCase());
}

function genAccountCode(userId, seq, tierSlug) {
  const base = 150000 + Number(userId || 0);
  const idx = String(seq).padStart(2, '0');
  const tierCode = tierCodeFromSlug(tierSlug);
  return `GV${base}-${idx}-${tierCode}`;
}

exports.getMyAccounts = async (req, res) => {
  try {
    const { id } = req.user;

    const q = await pool.query(
      `SELECT a.id, a.account_code, a.status, a.balance_cents, a.profit_cents, a.created_at,
              t.id AS tier_id, t.name AS tier_name, t.slug AS tier_slug
       FROM accounts a
       LEFT JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.user_id=$1
       ORDER BY a.id ASC`,
      [id]
    );

    return res.json(q.rows);
  } catch (err) {
    console.error('getMyAccounts error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getAccountById = async (req, res) => {
  try {
    const accountId = Number(req.params.id);
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT a.id, a.account_code, a.status, a.balance_cents, a.profit_cents, a.created_at,
              t.id AS tier_id, t.name AS tier_name, t.slug AS tier_slug
       FROM accounts a
       LEFT JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.id=$1 AND a.user_id=$2
       LIMIT 1`,
      [accountId, userId]
    );

    if (!q.rows.length)
      return res.status(404).json({ message: 'Account not found' });

    return res.json(q.rows[0]);
  } catch (err) {
    console.error('getAccountById error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.createAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { tier_code } = req.body; // expected slug: 'standard' | 'pro' | 'elite'
    if (!tier_code) return res.status(400).json({ message: 'tier_code is required' });

    // resolve tier by slug
    const t = await client.query('SELECT id, name, slug FROM account_tiers WHERE slug=$1 LIMIT 1', [tier_code]);
    if (!t.rows.length) return res.status(400).json({ message: 'Invalid tier' });
    const tier = t.rows[0];

    await client.query('BEGIN');

    // per-user sequence
    const cntRes = await client.query('SELECT COUNT(*)::int AS c FROM accounts WHERE user_id=$1', [userId]);
    const seq = (cntRes.rows[0]?.c || 0) + 1;
    const account_code = genAccountCode(userId, seq, tier.slug);

    const insert = await client.query(
  `INSERT INTO accounts (user_id, tier_id, account_code, status, balance_cents, profit_cents, created_at)
   VALUES ($1, $2, $3, 'active', 0, 0, NOW())
   RETURNING id, account_code, status, balance_cents, profit_cents, created_at`,
  [userId, tier.id, account_code]
);

const acc = insert.rows[0];

// 🔑 OPENING LEDGER ENTRY — SAME TRANSACTION
await postTransaction({
  userId,
  accountId: acc.id,
  type: 'opening_balance',
  amountCents: 0
}, client);

await client.query('COMMIT');

return res.status(201).json({
  ...acc,
  tier: { id: tier.id, slug: tier.slug, name: tier.name }
});

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('createAccount error', err);
    // handle unique constraint on account_code
    if (String(err.code) === '23505') {
      return res.status(409).json({ message: 'Account code conflict, please retry' });
    }
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

const { requireDemoAccount } = require('../middlewares/accountGuards');

exports.resetDemo = async (req, res) => {
  const account = req.account;

  requireDemoAccount(account);

  const DEFAULT = 1_000_000;
  const diff = DEFAULT - account.balance_cents;

  await postTransaction({
    userId: req.user.id,
    accountId: account.id,
    type: 'demo_reset',
    amountCents: diff
  }, req.db);

  res.json({ success: true });
};
