'use strict';

const db = require('../db');
const { applyWalletDelta } = require('../services/wallet.service');

const confirmDeposit = async (req, res) => {
  const { depositId } = req.params;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT *
      FROM deposits
      WHERE id = $1
      FOR UPDATE
      `,
      [depositId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Deposit not found' });
    }

    const deposit = rows[0];

    if (deposit.status === 'SUCCESS') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Already confirmed' });
    }

    if (deposit.status !== 'USER_MARKED_PAID') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Deposit not ready for confirmation' });
    }

    if (deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Deposit expired' });
    }
    
    // Credit wallet
    await applyWalletDelta(
      client,
      deposit.user_id,
      'REAL',
      Number(deposit.amount_exact_cents),
      'BANK_DEPOSIT'
    );

    // Update deposit status
    await client.query(
      `
      UPDATE deposits
      SET status = 'SUCCESS'
      WHERE id = $1
      `,
      [depositId]
    );

    await client.query('COMMIT');

    return res.json({ message: 'Deposit confirmed successfully' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ message: 'Failed to confirm deposit' });
  } finally {
    client.release();
  }
};

module.exports = { confirmDeposit };