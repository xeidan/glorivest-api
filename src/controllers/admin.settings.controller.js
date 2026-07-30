'use strict';

const { pool } = require('../config/database');

async function getSettings(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT key, value
      FROM settings
      ORDER BY key
    `);

    const settings = {};

    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return res.json(settings);

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: 'Failed to load settings'
    });
  }
}

async function updateSettings(req, res) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    //
    // Maintenance
    //
    if (req.body.maintenance) {

      const {
        enabled,
        title,
        message,
        endsAt
      } = req.body.maintenance;

      const value = {
        enabled,
        title,
        message,
        endsAt,
        updatedBy: req.admin.id,
        updatedAt: new Date().toISOString()
      };

      await client.query(
        `
        INSERT INTO settings(key,value)
        VALUES ('maintenance',$1)
        ON CONFLICT (key)
        DO UPDATE
        SET
          value = EXCLUDED.value,
          updated_at = NOW()
        `,
        [value]
      );
    }

    //
    // USDT Rate
    //
    if (req.body.usdt_ngn_rate != null) {

      await client.query(
        `
        INSERT INTO settings(key,value)
        VALUES('USDT_NGN_RATE',$1)
        ON CONFLICT(key)
        DO UPDATE
        SET
          value = EXCLUDED.value,
          updated_at = NOW()
        `,
        [Number(req.body.usdt_ngn_rate)]
      );

    }

    await client.query('COMMIT');

    return res.json({
      success: true
    });

  } catch (err) {

    await client.query('ROLLBACK');

    console.error(err);

    return res.status(500).json({
      message: 'Failed to update settings'
    });

  } finally {

    client.release();

  }
}

module.exports = {
  getSettings,
  updateSettings
};