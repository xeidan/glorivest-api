// src/utils/email.js
'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ⚠️ For now use Resend default domain (works instantly)
// Later replace with: no-reply@glorivest.com after domain verification
const FROM_EMAIL = 'onboarding@resend.dev';

// ✦ Email Templates
const EmailTpl = {
  welcome: ({ email }) => `
    <div style="font-family: Arial; padding: 20px;">
      <h2>Welcome to Glorivest 🎉</h2>
      <p>Hi ${email},</p>
      <p>Your account has been successfully created. We're glad to have you on board.</p>
      <p>— Glorivest Team</p>
    </div>
  `
};

// ✦ Safe Mail Wrapper (production-safe + fallback logging)
async function sendMailSafe({ to, subject, html }) {
  if (!to) return false;

  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[email:dev] Skipped sending email to:', to);
      return true;
    }

    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html
    });

    return true;

  } catch (err) {
    console.error('[email] send failed:', err.message);

    // 🔴 CRITICAL: OTP fallback for launch
    if (html) {
      const otpMatch = html.match(/\d{4,6}/);
      if (otpMatch) {
        console.log('[OTP FALLBACK]:', otpMatch[0]);
      }
    }

    return false;
  }
}

module.exports = {
  sendMailSafe,
  EmailTpl
};