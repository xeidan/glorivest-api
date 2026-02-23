'use strict';

const {
  createBankDeposit,
  markDepositPaid
} = require('../services/deposit.service');

async function createDeposit(req, res) {
  try {
    const userId = req.user.id;
    const { amount_cents } = req.body;

    if (!amount_cents || amount_cents < 5000) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const deposit = await createBankDeposit(userId, amount_cents);

    res.json(deposit);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create deposit' });
  }
}

async function markPaid(req, res) {
  try {
    const userId = req.user.id;
    const { depositId } = req.params;

    await markDepositPaid(userId, depositId);

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update deposit' });
  }
}


async function markDepositPaid(userId, depositId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT *
      FROM deposits
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [depositId, userId]
    );

    if (!rows.length) {
      throw new Error('Deposit not found');
    }

    if (rows[0].status !== 'AWAITING_PAYMENT') {
      throw new Error('Invalid deposit state');
    }

    await client.query(
      `
      UPDATE deposits
      SET status = 'USER_MARKED_PAID'
      WHERE id = $1
      `,
      [depositId]
    );

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createDeposit,
  markPaid,
  markDepositPaid
};