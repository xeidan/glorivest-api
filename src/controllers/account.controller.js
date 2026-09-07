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
     a.user_id,
     a.account_code,
     a.account_type,
     a.status,
     a.balance_cents,
     a.profit_cents,
     a.locked_balance_cents,
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
    const userId = req.user.id;

    const userQ = await pool.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [userId]
    );

    if (!userQ.rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const walletsQ = await pool.query(
      `
      SELECT id, code, type, balance_cents, status
      FROM wallets
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [userId]
    );

    return res.json({
      id: userQ.rows[0].id,
      email: userQ.rows[0].email,
      glorivest_id: `GV${150000 + userId}`,
      wallets: walletsQ.rows
    });
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
    const { tier_code } = req.body;

    if (!tier_code) {
      return res.status(400).json({ message: 'tier_code is required' });
    }

    const tierRes = await client.query(
      'SELECT id, name, slug FROM account_tiers WHERE slug=$1 LIMIT 1',
      [tier_code]
    );

    if (!tierRes.rows.length) {
      return res.status(400).json({ message: 'Invalid tier' });
    }

    const tier = tierRes.rows[0];
    const isDemo = tier.slug === 'demo';
    const startingBalance = isDemo ? 1_000_000 : 0;

    await client.query('BEGIN');

    const cntRes = await client.query(
      'SELECT COUNT(*)::int AS c FROM accounts WHERE user_id=$1',
      [userId]
    );

    const seq = cntRes.rows[0].c + 1;
    const account_code = genAccountCode(userId, seq, tier.slug);

    const insert = await client.query(
      `INSERT INTO accounts
       (user_id, tier_id, account_code, status, balance_cents, profit_cents, created_at)
       VALUES ($1, $2, $3, 'active', $4, 0, NOW())
       RETURNING id, account_code, status, balance_cents, profit_cents, created_at`,
      [userId, tier.id, account_code, startingBalance]
    );

    const acc = insert.rows[0];

    await postTransaction({
      userId,
      accountId: acc.id,
      type: 'opening_balance',
      amountCents: startingBalance
    }, client);

    await client.query('COMMIT');

    return res.status(201).json({
      ...acc,
      tier: { id: tier.id, slug: tier.slug, name: tier.name }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
};


/* =========================================================
   RESET DEMO ACCOUNT
========================================================= */
exports.resetDemo = async (req, res) => {
  const client = await pool.connect();

  try {
    const account = req.account;

    requireDemoAccount(account);

    const DEFAULT = 1_000_000;

    await client.query('BEGIN');

    // -----------------------------------------------------
    // 1. Clear all DEMO cycle history for this account
    // -----------------------------------------------------
    await client.query(
      `
      DELETE FROM cycles
      WHERE account_id = $1
        AND user_id = $2
      `,
      [
        account.id,
        req.user.id
      ]
    );

    // -----------------------------------------------------
    // 2. Reset locked DEMO capital
    // -----------------------------------------------------
    await client.query(
      `
      UPDATE accounts
      SET
        balance_cents = $1,
        locked_balance_cents = 0,
        profit_cents = 0,
        updated_at = NOW()
      WHERE id = $2
        AND user_id = $3
        AND account_type = 'DEMO'
      `,
      [
        DEFAULT,
        account.id,
        req.user.id
      ]
    );

    // -----------------------------------------------------
    // 3. Record the reset in the ledger
    // -----------------------------------------------------
    const diff =
      DEFAULT - Number(account.balance_cents || 0);

    if (diff !== 0) {
      await postTransaction(
        {
          userId: req.user.id,
          accountId: account.id,
          type: 'demo_reset',
          amountCents: diff
        },
        client
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      balance_cents: DEFAULT
    });

  } catch (err) {

    await client.query('ROLLBACK');

    console.error(
      'resetDemo error:',
      err
    );

    return res.status(500).json({
      message: 'Demo reset failed'
    });

  } finally {
    client.release();
  }
};
