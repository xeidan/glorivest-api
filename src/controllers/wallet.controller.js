'use strict';

const { pool } = require('../config/database');

const {
  resetWallet,
  transferBetweenWallets
} = require('../services/wallet.service');

const DEMO_BALANCE_CENTS = 1_000_000;
const LIVE_WALLET_TYPE = 'LIVE';


// ======================================================
// GET USER WALLETS / ACCOUNTS
// ======================================================

const getWallets = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        account_code,
        account_type,
        balance_cents,
        locked_balance_cents,
        status,
        created_at
      FROM accounts
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [req.user.id]
    );


    const wallets = rows.map(account => {
      const accountType =
        String(account.account_type || '').toUpperCase();

      let type;

      if (accountType === 'DEMO') {
        type = 'DEMO';
      } else if (accountType === 'REFERRAL') {
        type = 'REFERRAL';
      } else {
        type = 'LIVE';
      }

      return {
        id: account.id,

        // Keep both names for frontend compatibility
        code: account.account_code,
        account_code: account.account_code,

        // UI-facing wallet type
        type,

        // Database account type
        account_type: accountType,

        balance_cents: Number(account.balance_cents || 0),

        locked_balance_cents: Number(
          account.locked_balance_cents || 0
        ),

        status: account.status,

        created_at: account.created_at
      };
    });

    res.json(wallets);

  } catch (err) {
    console.error('Get wallets failed:', err);

    res.status(500).json({
      message: 'Server error'
    });
  }
};


// ======================================================
// RESET DEMO WALLET
// ======================================================

const resetDemoWalletController = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;

    await client.query('BEGIN');

    /*
     * Reset the DEMO account to $10,000.
     *
     * The wallet service works against the accounts table,
     * so this deliberately does NOT use the old wallets table.
     */
    const newBalance = await resetWallet(
      client,
      userId,
      'DEMO',
      DEMO_BALANCE_CENTS
    );

    /*
     * Find the user's DEMO account.
     */
    const { rows: demoAccounts } = await client.query(
      `
      SELECT id
      FROM accounts
      WHERE user_id = $1
        AND account_type = 'DEMO'
      LIMIT 1
      `,
      [userId]
    );

    const demoAccount = demoAccounts[0];

/*
 * Cancel any currently running demo cycles.
 *
 * cycles.account_id references the corresponding
 * DEMO account ID.
 */
if (demoAccount) {
  await client.query(
    `
    UPDATE cycles
    SET status = 'CANCELLED'
    WHERE account_id = $1
      AND status NOT IN ('COMPLETED', 'CANCELLED')
    `,
    [demoAccount.id]
  );
}

    await client.query('COMMIT');

    res.json({
      message: 'Demo balance reset successfully',
      balance_cents: newBalance
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('Demo reset failed:', err);

    res.status(500).json({
      message: 'Server error'
    });

  } finally {
    client.release();
  }
};


// ======================================================
// TRANSFER REFERRAL → LIVE ACCOUNT
// ======================================================

const transferReferralToReal = async (req, res) => {
  const userId = req.user.id;

  const amount = Number(req.body.amount_cents);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      message: 'Invalid amount'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * Confirm both accounts exist and lock them.
     */
    const { rows: accounts } = await client.query(
      `
      SELECT
        id,
        account_type,
        balance_cents
      FROM accounts
      WHERE user_id = $1
        AND account_type IN ('REFERRAL', $2)
      ORDER BY id
      FOR UPDATE
      `,
      [userId, LIVE_WALLET_TYPE]
    );

    const referralAccount = accounts.find(
      account => account.account_type === 'REFERRAL'
    );

    const liveAccount = accounts.find(
      account => account.account_type === LIVE_WALLET_TYPE
    );

    if (!referralAccount) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        message: 'Referral account not found'
      });
    }

    if (!liveAccount) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        message: 'Live account not found'
      });
    }

    /*
     * Check referral balance before transferring.
     */
    if (Number(referralAccount.balance_cents) < amount) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        message: 'Insufficient referral balance'
      });
    }

    /*
     * Use the wallet service for the actual transfer.
     *
     * This keeps the debit, credit, ledger and transaction
     * records inside the same financial engine.
     */
    await transferBetweenWallets(
      client,
      userId,
      'REFERRAL',
      LIVE_WALLET_TYPE,
      amount,
      {
        reference: 'REFERRAL_TRANSFER',
        meta: {
          from_wallet: 'REFERRAL',
          to_wallet: LIVE_WALLET_TYPE
        }
      }
    );

    await client.query('COMMIT');

    res.json({
      message: 'Transfer successful',
      amount_cents: amount
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('Referral transfer error:', err);

    res.status(500).json({
      message: 'Transfer failed'
    });

  } finally {
    client.release();
  }
};


// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  getWallets,
  resetDemoWalletController,
  transferReferralToReal
};