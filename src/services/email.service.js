'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ Use a real sender (NOT no-reply)
const FROM_EMAIL = 'Glorivest <support@glorivest.com>';

/**
 * Send OTP email (production-safe)
 */
async function sendOTPEmail(to, otp) {
  if (!to) {
    console.error('❌ No recipient email provided');
    return false;
  }

  try {
    console.log('📨 Sending OTP email →', to);

    const subject = 'Your Glorivest verification code (expires in 10 minutes)';

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
        <h2 style="margin-bottom: 10px;">Verify your email</h2>
        <p>Use the code below to continue:</p>

        <div style="
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 4px;
          margin: 20px 0;
        ">
          ${otp}
        </div>

        <p>This code expires in 10 minutes.</p>

        <hr style="margin: 30px 0;" />

        <p style="font-size: 12px; color: #777;">
          If you didn’t request this, you can safely ignore this email.
        </p>

        <p style="font-size: 12px; color: #777;">
          — Glorivest Team
        </p>
      </div>
    `;

    // ✅ Plain text version (VERY important for deliverability)
    const text = `
Your Glorivest verification code:

${otp}

This code expires in 10 minutes.

If you didn’t request this, ignore this email.
— Glorivest
    `;

    const response = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text
    });

    console.log('✅ Email sent:', response);

    return true;

  } catch (err) {
    console.error('❌ Email send failed FULL:', err);

    // 🔴 Fallback so flow never breaks
    console.log('⚠️ OTP FALLBACK:', otp);

    return false;
  }
}

module.exports = {
  sendOTPEmail
};