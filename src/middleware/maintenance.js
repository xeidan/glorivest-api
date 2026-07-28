'use strict';

const { pool } = require('../config/database');

module.exports = async function maintenance(req, res, next) {
      console.log('🟡 Maintenance middleware:', req.originalUrl);
  try {
    // Always allow health checks
    if (req.path === '/health') {
      return next();
    }

    // Always allow auth endpoints
    const publicRoutes = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/verify-otp',
      '/api/auth/resend-otp'
    ];

    if (publicRoutes.includes(req.originalUrl)) {
      return next();
    }

    // Get maintenance settings
    const { rows } = await pool.query(
      `
      SELECT value
      FROM settings
      WHERE key = 'maintenance'
      LIMIT 1
      `
    );

    if (!rows.length) {
      return next();
    }

    const settings = rows[0].value || {};

    // Maintenance disabled
    if (!settings.enabled) {
      return next();
    }

    // Allow admins through
    if (req.user?.id) {
      const { rows: adminRows } = await pool.query(
        `
        SELECT role
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

      if (
        adminRows.length &&
        typeof adminRows[0].role === 'string' &&
        adminRows[0].role.toLowerCase() === 'admin'
      ) {
        return next();
      }
    }

    // Everyone else sees maintenance response
    return res.status(503).json({
      maintenance: true,
      title: settings.title || "We'll be back shortly",
      message:
        settings.message ||
        'We are currently performing scheduled maintenance.',
      endsAt: settings.endsAt || null
    });
  } catch (err) {
    console.error('Maintenance middleware:', err);

    // Never block the app because of a maintenance check failure
    return next();
  }
};