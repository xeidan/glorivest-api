// src/models/settings.js
'use strict';

const { pool } = require('../config/database');

exports.createSettingsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
};
