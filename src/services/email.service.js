'use strict';

const { Resend } = require('resend');

let resend = null;

if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// =====================================================
// CONFIG
// =====================================================

const FROM_EMAIL = 'Glorivest <support@glorivest.com>';

// =====================================================
// GENERIC EMAIL SENDER
// =====================================================

async function sendEmail({
  to,
  subject,
  html,
  text
}) {
  if (!to) {
    console.error('❌ No recipient email provided');
    return false;
  }

  if (!resend) {
    console.log('⚠️ Email service disabled');
    return false;
  }

  try {
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
    console.error('❌ Email send failed:', err);

    return false;
  }
}

// =====================================================
// OTP EMAIL
// =====================================================

async function sendOTPEmail(to, otp) {

  const subject =
    'Your Glorivest verification code (expires in 10 minutes)';

  const html = `
    <div style="font-family:Arial,sans-serif;padding:24px;line-height:1.6;max-width:600px;margin:auto;">

      <h2 style="margin-bottom:10px;">
        Verify your email
      </h2>

      <p>
        Use the verification code below to continue:
      </p>

      <div
        style="
          font-size:34px;
          font-weight:bold;
          letter-spacing:6px;
          margin:30px 0;
          color:#0F172A;
        "
      >
        ${otp}
      </div>

      <p>
        This code expires in
        <strong>10 minutes</strong>.
      </p>

      <hr style="margin:35px 0;" />

      <p style="font-size:13px;color:#666;">
        If you didn't request this code,
        you can safely ignore this email.
      </p>

      <p style="font-size:13px;color:#666;">
        — Glorivest Team
      </p>

    </div>
  `;

  const text = `
Your Glorivest verification code

${otp}

This code expires in 10 minutes.

If you didn't request this, you can ignore this email.

— Glorivest
`;

  return sendEmail({
    to,
    subject,
    html,
    text
  });
}

// =====================================================
// WELCOME EMAIL
// =====================================================

async function sendWelcomeEmail({
  to,
  firstName = 'Investor'
}) {

  const subject = 'Welcome to Glorivest 🎉';

  const html = `
  <div style="
      font-family:Arial,sans-serif;
      max-width:650px;
      margin:auto;
      background:#ffffff;
      color:#111827;
      line-height:1.7;
      padding:40px;
  ">

      <h1 style="margin:0 0 20px;">
        Welcome to Glorivest 👋
      </h1>

      <p>
        Hi <strong>${firstName}</strong>,
      </p>

      <p>
        Welcome to Glorivest.
      </p>

      <p>
        Your account has been created successfully and you're now part of a
        growing community of investors building long-term wealth.
      </p>

      <h3>What you can do next</h3>

      <ul>
        <li>Complete your profile</li>
        <li>Fund your account</li>
        <li>Explore investment opportunities</li>
        <li>Track your portfolio performance</li>
      </ul>

      <div style="margin:40px 0;">
        <a
          href="https://glorivest.com"
          style="
            background:#00D2B1;
            color:#ffffff;
            text-decoration:none;
            padding:14px 28px;
            border-radius:8px;
            display:inline-block;
            font-weight:bold;
          "
        >
          Open Glorivest
        </a>
      </div>

      <hr style="margin:35px 0;">

      <p style="font-size:13px;color:#6B7280;">
        If you have any questions,
        simply reply to this email or contact our support team.
      </p>

      <p style="font-size:13px;color:#6B7280;">
        Thanks for choosing Glorivest.
      </p>

      <p style="font-size:13px;color:#6B7280;">
        — The Glorivest Team
      </p>

  </div>
  `;

  const text = `
Welcome to Glorivest

Hi ${firstName},

Your account has been created successfully.

You can now:

• Complete your profile
• Fund your account
• Start investing
• Track your portfolio

Visit:
https://glorivest.com

The Glorivest Team
`;

  return sendEmail({
    to,
    subject,
    html,
    text
  });
}

// =====================================================

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail
};