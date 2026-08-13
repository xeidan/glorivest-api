'use strict';

const { pool } = require('../config/database');

async function getMyTransactions(req, res) {
  try {
    const userId = req.user.id;

    /*
     * Optional account selection:
     *
     * /api/transactions?accountId=16
     *
     * If no accountId is supplied, default to the user's LIVE account.
     */

    let accountId = req.query.accountId
      ? Number(req.query.accountId)
      : null;

    if (accountId !== null && !Number.isInteger(accountId)) {
      return res.status(400).json({
        message: 'Invalid accountId'
      });
    }

    // --------------------------------------------------
    // GET ACCOUNT
    // --------------------------------------------------

    let account;

    if (accountId !== null) {
      const accountRes = await pool.query(
        `
        SELECT
          id,
          user_id,
          account_code,
          account_type
        FROM accounts
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [accountId, userId]
      );

      if (!accountRes.rows.length) {
        return res.status(404).json({
          message: 'Account not found'
        });
      }

      account = accountRes.rows[0];

    } else {

      const accountRes = await pool.query(
        `
        SELECT
          id,
          user_id,
          account_code,
          account_type
        FROM accounts
        WHERE user_id = $1
          AND account_type = 'LIVE'
        LIMIT 1
        `,
        [userId]
      );

      if (!accountRes.rows.length) {
        return res.json([]);
      }

      account = accountRes.rows[0];
    }

    // --------------------------------------------------
    // GET TRANSACTIONS
    // --------------------------------------------------

    const { rows } = await pool.query(
      `
      SELECT
        id,
        user_id,
        account_id,
        type,
        amount_cents,
        balance_after_cents,
        reference,
        meta,
        created_at
      FROM transactions
      WHERE user_id = $1
        AND account_id = $2
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [
        userId,
        account.id
      ]
    );

    return res.json({
      account: {
        id: account.id,
        account_code: account.account_code,
        account_type: account.account_type
      },
      transactions: rows
    });

  } catch (err) {
    console.error('getMyTransactions error:', err);

    return res.status(500).json({
      message: 'Failed to load transactions'
    });
  }
}

module.exports = {
  getMyTransactions
};