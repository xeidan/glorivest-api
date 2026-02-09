'use strict';

const { pool } = require('../config/database');

async function listPositions(req, res) {
    const userId = req.user.id;

    const {
        status,        // open | closed
        wallet,        // REAL | DEMO | REFERRAL
        limit = 50,
        offset = 0
    } = req.query;

    const values = [userId];
    let where = `p.user_id = $1`;
    let i = 2;

    if (status) {
        where += ` AND p.status = $${i++}`;
        values.push(status.toUpperCase());
    }

    if (wallet) {
        where += ` AND w.type = $${i++}`;
        values.push(wallet.toUpperCase());
    }

    const sql = `
        SELECT
            p.id,
            p.symbol,
            p.side,
            p.size,
            p.entry_price,
            p.exit_price,
            p.pnl_cents,
            p.status,
            p.opened_at,
            p.closed_at,
            w.type AS wallet_type
        FROM positions p
        JOIN wallets w ON w.id = p.wallet_id
        WHERE ${where}
        ORDER BY
            CASE WHEN p.status = 'OPEN' THEN 0 ELSE 1 END,
            p.opened_at DESC
        LIMIT $${i++}
        OFFSET $${i}
    `;

    values.push(Number(limit), Number(offset));

    try {
        const { rows } = await pool.query(sql, values);

        res.json({
            success: true,
            data: rows,
            meta: {
                limit: Number(limit),
                offset: Number(offset),
                returned: rows.length
            }
        });
    } catch (err) {
        console.error('listPositions error', err);
        res.status(500).json({ success: false });
    }
}

module.exports = { listPositions };
