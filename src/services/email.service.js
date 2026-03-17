'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send OTP email
 */
async function sendOTPEmail(to, otp) {
  if (!to) {
    console.error('❌ No recipient email provided');
    return false;
  }

  try {
    console.log('📨 Attempting to send OTP email →', to);

    const response = await resend.emails.send({
      from: 'Glorivest <no-reply@glorivest.com>',
      to,
      subject: 'Your Glorivest OTP',
      html: `
        <div style="font-family: sans-serif;">
          <h2>Your OTP Code</h2>
          <p>Use the code below to continue:</p>
          <h1>${otp}</h1>
          <p>This code expires shortly.</p>
        </div>
      `
    });

    console.log('✅ Email API response:', response);

    return true;

  } catch (err) {
    console.error('❌ Email send failed FULL:', err);

    // fallback so you don’t get blocked
    console.log('⚠️ OTP FALLBACK:', otp);

    return false;
  }
}

module.exports = {
  sendOTPEmail
};