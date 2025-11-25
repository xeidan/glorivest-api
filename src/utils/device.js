const pool = require('../config/database').pool;

async function logDevice(userId, userAgent, ip) {
  try {
    await pool.query(
      `INSERT INTO devices (user_id, user_agent, ip_address)
       VALUES ($1, $2, $3)`,
      [userId, userAgent, ip]
    );
  } catch (err) {
    console.error('Device log error:', err);
  }
}

async function getDevices(userId) {
  const q = await pool.query(
    `SELECT id, user_agent, ip_address, created_at
     FROM devices
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT 30`,
    [userId]
  );
  return q.rows;
}

module.exports = { logDevice, getDevices };
