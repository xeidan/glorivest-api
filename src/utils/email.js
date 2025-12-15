// src/utils/email.js
'use strict';

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const FROM_EMAIL = 'no-reply@glorivest.com';

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

// ✦ Safe Mail Wrapper (won’t crash if email fails)
async function sendMailSafe({ to, subject, html }) {
  if (!to) return false;

  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[email:dev] Skipped sending email to:', to);
      return true;
    }

    await sgMail.send({
      to,
      from: FROM_EMAIL,
      subject,
      html
    });

    return true;
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return false;
  }
}

module.exports = {
  sendMailSafe,
  EmailTpl
};
