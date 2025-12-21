'use strict';

const pool = require('../config/database').pool;
const { postTransaction } = require('../services/ledger.service');
const { requireDemoAccount } = require('../middleware/accountGuards');

/** Map tier slug → 3-letter code */
function tierCodeFromSlug(slug) {
  const map = { standard: 'STD', pro: 'PRO', elite: 'ELT', demo: 'DEM' };
  return (map[slug] || (slug || '').slice(0, 3).toUpperCase());
}

function genAccountCode(userId, seq, tierSlug) {
  const base = 150000 + Number(userId || 0);
  const idx = String(seq).padStart(2, '0');
  const tierCode = tierCodeFromSlug(tierSlug);
  return `GV${base}-${idx}-${tierCode}`;
}

/* =========================================================
   GET ALL USER ACCOUNTS
========================================================= */
exports.getMyAccounts = async (req, res) => {
  try {
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT 
         a.id,
         a.account_code,
         a.status,
         a.balance_cents,
         a.profit_cents,
         a.created_at,
         t.id   AS tier_id,
         t.name AS tier_name,
         t.slug AS tier_slug
       FROM accounts a
       LEFT JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.user_id = $1
       ORDER BY a.id ASC`,
      [userId]
    );

    return res.json(q.rows);
  } catch (err) {
    console.error('getMyAccounts error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* =========================================================
   GET SINGLE ACCOUNT
========================================================= */
exports.getAccountById = async (req, res) => {
  try {
    const accountId = Number(req.params.id);
    const userId = req.user.id;

    const q = await pool.query(
      `SELECT 
         a.id,
         a.account_code,
         a.status,
         a.balance_cents,
         a.profit_cents,
         a.created_at,
         t.id   AS tier_id,
         t.name AS tier_name,
         t.slug AS tier_slug
       FROM accounts a
       LEFT JOIN account_tiers t ON t.id = a.tier_id
       WHERE a.id = $1 AND a.user_id = $2
       LIMIT 1`,
      [accountId, userId]
    );

    if (!q.rows.length) {
      return res.status(404).json({ message: 'Account not found' });
    }

    return res.json(q.rows[0]);
  } catch (err) {
    console.error('getAccountById error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* =========================================================
   CREATE ACCOUNT
========================================================= */
exports.createAccount = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const { tier_code } = req.body; // demo | standard | pro | elite

    if (!tier_code) {
      return res.status(400).json({ message: 'tier_code is required' });
    }

    const tierRes = await client.query(
      'SELECT id, name, slug FROM account_tiers WHERE slug = $1 LIMIT 1',
      [tier_code]
    );

    if (!tierRes.rows.length) {
      return res.status(400).json({ message: 'Invalid tier' });
    }

    const tier = tierRes.rows[0];
    const isDemo = tier.slug === 'demo';
    const startingBalance = isDemo ? 1_000_000 : 0; // $10,000 demo

    await client.query('BEGIN');

    const countRes = await client.query(
      'SELECT COUNT(*)::int AS c FROM accounts WHERE user_id = $1',
      [userId]
    );

    const seq = (countRes.rows[0]?.c || 0) + 1;
    const accountCode = genAccountCode(userId, seq, tier.slug);

    const insertRes = await client.query(
      `INSERT INTO accounts (
         user_id,
         tier_id,
         account_code,
         status,
         balance_cents,
         profit_cents,
         created_at
       )
       VALUES ($1, $2, $3, 'active', $4, 0, NOW())
       RETURNING id, account_code, status, balance_cents, profit_cents, created_at`,
      [userId, tier.id, accountCode, startingBalance]
    );

    const account = insertRes.rows[0];

    // Opening ledger entry
    await postTransaction(
      {
        userId,
        accountId: account.id,
        type: 'opening_balance',
        amountCents: startingBalance
      },
      client
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ...account,
      tier: {
        id: tier.id,
        slug: tier.slug,
        name: tier.name
      }
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('createAccount error', err);

    if (String(err.code) === '23505') {
      return res.status(409).json({ message: 'Account code conflict' });
    }

    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};

/* =========================================================
   RESET DEMO ACCOUNT
========================================================= */
exports.resetDemo = async (req, res) => {
  const account = req.account;

  requireDemoAccount(account);

  const DEFAULT = 1_000_000; // $10,000
  const diff = DEFAULT - Number(account.balance_cents || 0);

  if (diff === 0) {
    return res.json({ success: true, message: 'Already at default balance' });
  }

  await postTransaction(
    {
      userId: req.user.id,
      accountId: account.id,
      type: 'demo_reset',
      amountCents: diff
    },
    req.db
  );

  return res.json({ success: true });
};
