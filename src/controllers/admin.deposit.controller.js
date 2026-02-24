'use strict';

const { pool } = require('../config/database');




async function listDeposits(req, res) {
  try {
    const { status } = req.query;

    const { rows } = await pool.query(
      `
      SELECT id,
             user_id,
             amount_requested_cents,
             amount_exact_cents,
             reference,
             method,
             status,
             expires_at,
             created_at
      FROM deposits
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      `,
      [status || null]
    );

    const now = new Date();

    const deposits = rows.map(d => {
      const isExpired =
        d.status !== 'SUCCESS' &&
        d.expires_at &&
        new Date(d.expires_at) < now;

      return {
        id: d.id,
        user_id: d.user_id,
        amount_requested_cents: Number(d.amount_requested_cents),
        amount_exact_cents: Number(d.amount_exact_cents),
        reference: d.reference,
        method: d.method,
        status: isExpired ? 'EXPIRED' : d.status,
        expires_at: d.expires_at,
        created_at: d.created_at,
        is_expired: Boolean(isExpired)
      };
    });

    return res.json(deposits);

  } catch (err) {
    console.error('listDeposits error:', err);
    return res.status(500).json({ message: 'Failed to fetch deposits' });
  }
}

module.exports = { listDeposits };