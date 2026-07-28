'use strict';

const { pool } = require('../config/database');

module.exports = async function maintenance(req, res, next) {
  // ===== DEBUG START =====
  console.log('\n==============================');
  console.log('🟡 Maintenance middleware');
  console.log('URL:', req.originalUrl);
  console.log('PATH:', req.path);
  console.log('==============================');
  // ===== DEBUG END =====

  try {
    // Allow health endpoint
    if (req.path === '/health') {
      // ===== DEBUG START =====
      console.log('✅ Health check allowed');
      // ===== DEBUG END =====
      return next();
    }

    // Public routes
    const publicRoutes = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/verify-otp',
      '/api/auth/resend-otp'
    ];

    if (publicRoutes.includes(req.originalUrl)) {
      // ===== DEBUG START =====
      console.log('✅ Public auth route allowed');
      // ===== DEBUG END =====
      return next();
    }

    // Fetch maintenance settings
    const { rows } = await pool.query(
      `
      SELECT value
      FROM settings
      WHERE key = 'maintenance'
      LIMIT 1
      `
    );

    // ===== DEBUG START =====
    console.log('Database rows:', rows);
    // ===== DEBUG END =====

    if (!rows.length) {
      // ===== DEBUG START =====
      console.log('❌ No maintenance settings found');
      // ===== DEBUG END =====
      return next();
    }

    const settings = rows[0].value || {};

    // ===== DEBUG START =====
    console.log('Settings object:', settings);
    console.log('Enabled:', settings.enabled);
    console.log('Enabled type:', typeof settings.enabled);
    console.log('Title:', settings.title);
    console.log('Message:', settings.message);
    console.log('EndsAt:', settings.endsAt);
    // ===== DEBUG END =====

    if (!settings.enabled) {
      // ===== DEBUG START =====
      console.log('🟢 Maintenance disabled');
      // ===== DEBUG END =====
      return next();
    }

    // ===== DEBUG START =====
    console.log('🔴 Maintenance ENABLED');
    // ===== DEBUG END =====

    // Check for admin bypass
    if (req.user?.id) {
      // ===== DEBUG START =====
      console.log('Checking admin for user:', req.user.id);
      // ===== DEBUG END =====

      const { rows: adminRows } = await pool.query(
        `
        SELECT role
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

      // ===== DEBUG START =====
      console.log('Admin lookup:', adminRows);
      // ===== DEBUG END =====

      if (
        adminRows.length &&
        typeof adminRows[0].role === 'string' &&
        adminRows[0].role.toLowerCase() === 'admin'
      ) {
        // ===== DEBUG START =====
        console.log('✅ Admin bypass granted');
        // ===== DEBUG END =====
        return next();
      }
    } else {
      // ===== DEBUG START =====
      console.log('No authenticated user attached to request');
      // ===== DEBUG END =====
    }

    // ===== DEBUG START =====
    console.log('⛔ Returning HTTP 503');
    console.log('==============================\n');
    // ===== DEBUG END =====

    return res.status(503).json({
      maintenance: true,
      title: settings.title || "We'll be back shortly",
      message:
        settings.message ||
        'We are currently performing scheduled maintenance.',
      endsAt: settings.endsAt || null
    });
  } catch (err) {
    // ===== DEBUG START =====
    console.error('❌ Maintenance middleware error');
    console.error(err);
    console.log('==============================\n');
    // ===== DEBUG END =====

    // Never block the app because of a maintenance check failure
    return next();
  }
};