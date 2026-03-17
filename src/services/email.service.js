'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Glorivest <no-reply@glorivest.com>';

/**
 * CORE EMAIL SENDER
 */
async function sendEmail({ to, subject, html }) {
  if (!to) {
    console.error('❌ Missing recipient');
    return false;
  }

  try {
    console.log('📨 Sending email →', to);

    const res = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html
    });

    console.log('✅ Email sent:', res);
    return true;

  } catch (err) {
    console.error('❌ Email error FULL:', err);

    // fallback: log OTP if present
    const otpMatch = html?.match(/\d{4,6}/);
    if (otpMatch) {
      console.log('⚠️ OTP FALLBACK:', otpMatch[0]);
    }

    return false;
  }
}

/**
 * OTP EMAIL
 */
function buildOTPEmail(otp) {
  return `
    <div style="font-family: sans-serif;">
      <h2>Your OTP Code</h2>
      <p>Use the code below:</p>
      <h1>${otp}</h1>
      <p>This code expires shortly.</p>
    </div>
  `;
}

/**
 * PUBLIC HELPERS
 */
async function sendOTPEmail(to, otp) {
  return sendEmail({
    to,
    subject: 'Your Glorivest OTP',
    html: buildOTPEmail(otp)
  });
}

async function sendWelcomeEmail(to) {
  return sendEmail({
    to,
    subject: 'Welcome to Glorivest',
    html: `<h2>Welcome to Glorivest</h2><p>Your account is ready.</p>`
  });
}

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail
};