'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send OTP email
 */
async function sendOTPEmail(to, otp) {
  try {
    await resend.emails.send({
      from: 'no-reply@glorivest.com',
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

  } catch (err) {
    console.error('Email send failed:', err);

    // 🔴 FALLBACK (DO NOT REMOVE TODAY)
    console.log('OTP FALLBACK:', otp);
  }
}

module.exports = {
  sendOTPEmail
};