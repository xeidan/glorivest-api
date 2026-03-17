// src/utils/loginHelpers.js
'use strict';

const pool = require('../config/database').pool;
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');
const { sendEmail } = require('../services/email.service');

async function saveLoginEvent({ user_id = null, ip, user_agent, fingerprint = null, succeeded = false, suspicious = false, reason = null }) {
  const geo = geoip.lookup(ip) || {};
  const country = geo.country || null;
  const city = (geo.city || null);

  const q = await pool.query(
    `INSERT INTO login_events (user_id, ip, user_agent, device_fingerprint, country, city, succeeded, suspicious, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [user_id, ip, user_agent, fingerprint, country, city, succeeded, suspicious, reason]
  );

  return q.rows[0];
}

async function upsertDevice({ user_id, fingerprint, user_agent, ip }) {
  const geo = geoip.lookup(ip) || {};
  const country = geo.country || null;
  const city = (geo.city || null);

  // try update existing device
  const updated = await pool.query(
    `UPDATE devices SET last_seen=NOW(), user_agent=$1, ip=$2, country=$3, city=$4
     WHERE user_id=$5 AND fingerprint=$6
     RETURNING *`,
    [user_agent, ip, country, city, user_id, fingerprint]
  );

  if (updated.rows.length) return updated.rows[0];

  const created = await pool.query(
    `INSERT INTO devices (user_id, fingerprint, user_agent, ip, country, city)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [user_id, fingerprint, user_agent, ip, country, city]
  );

  return created.rows[0];
}

async function getRecentDeviceCount(user_id, timeframeMinutes = 60) {
  const q = await pool.query(
    `SELECT COUNT(DISTINCT ip) as unique_ips
     FROM login_events
     WHERE user_id=$1
       AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [user_id, timeframeMinutes]
  );
  return parseInt(q.rows[0].unique_ips, 10) || 0;
}

async function sendLoginAlert({ email, ip, user_agent, time = new Date(), location = null }) {
  const subject = 'New sign-in to your Glorivest account';
  const html = EmailTpl?.loginAlert
    ? EmailTpl.loginAlert({ ip, user_agent, time, location })
    : `<p>New sign-in detected for your account:</p>
       <ul>
         <li>IP: ${ip}</li>
         <li>Device: ${user_agent}</li>
         <li>Time: ${time.toISOString()}</li>
         <li>Location: ${location || ''}</li>
       </ul>
       <p>If this wasn't you, change your password immediately.</p>
       <img src="file:///mnt/data/Screenshot 2025-11-25 at 01.05.50.png" alt="Glorivest" style="max-width:240px" />`;

  await sendMailSafe({ to: email, subject, html });
}

module.exports = {
  saveLoginEvent,
  upsertDevice,
  getRecentDeviceCount,
  sendLoginAlert
};
