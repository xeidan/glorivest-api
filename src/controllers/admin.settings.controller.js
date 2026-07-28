'use strict';

const { pool } = require('../config/database');

async function getSettings(req, res) {
  try {

    const { rows } = await pool.query(
      `
      SELECT value
      FROM settings
      WHERE key = 'maintenance'
      `
    );

    if (!rows.length) {
      return res.status(404).json({
        message: 'Maintenance settings not found'
      });
    }

    return res.json(rows[0].value);

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      message: 'Failed to load settings'
    });

  }
}

async function updateSettings(req, res) {

  try {

    const {

      maintenance,
      title,
      message,
      endsAt

    } = req.body;

    const value = {
    enabled: maintenance,
    allowAdmin: true,
    title,
    message,
    endsAt,
    updatedBy: req.admin.id,
    updatedAt: new Date().toISOString()
    };

    await pool.query(
      `
      UPDATE settings
      SET
        value = $1,
        updated_at = NOW()
      WHERE key = 'maintenance'
      `,
      [value]
    );

    return res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      message: 'Failed to update settings'
    });

  }

}

module.exports = {

  getSettings,
  updateSettings

};