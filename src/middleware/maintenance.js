'use strict';

const { pool } = require('../config/database');

const PUBLIC_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-otp',
  '/api/auth/resend-otp'
]);

module.exports = async function maintenance(req, res, next) {
  try {
    // Always allow health checks
    if (req.path === '/health') {
      return next();
    }

    // Allow public auth routes
    if (PUBLIC_ROUTES.has(req.originalUrl)) {
      return next();
    }

    const { rows } = await pool.query(
      `
      SELECT value
      FROM settings
      WHERE key = 'maintenance'
      LIMIT 1
      `
    );

    if (!rows.length) {
      console.warn('⚠️ Maintenance settings not found. Skipping maintenance check.');
      return next();
    }

    const settings = rows[0].value || {};

    // Maintenance disabled
    if (!settings.enabled) {
      return next();
    }

    console.log(`🟡 Maintenance mode active (${req.method} ${req.originalUrl})`);

    // Admin bypass
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

      const isAdmin =
        adminRows.length &&
        typeof adminRows[0].role === 'string' &&
        adminRows[0].role.toLowerCase() === 'admin';

      if (isAdmin) {
        console.log(`🟢 Maintenance bypass granted for admin ${req.user.id}`);
        return next();
      }
    }

    return res.status(503).json({
      maintenance: true,
      title: settings.title || "We'll be back shortly",
      message:
        settings.message ||
        'We are currently performing scheduled maintenance.',
      endsAt: settings.endsAt || null
    });
  } catch (err) {
    console.error('❌ Maintenance middleware failed:', err.message);

    // Fail open
    return next();
  }
};