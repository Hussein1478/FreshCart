
'use strict';

require('dotenv').config();

const nodemailer = require('nodemailer');

const isConfigured = () =>
  Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );

async function sendPasswordResetEmail(to, fullName, resetUrl) {
  if (!isConfigured()) {
    throw new Error('Email service is not configured. SMTP credentials are required.');
  }

  const port = Number(process.env.SMTP_PORT || 587);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const from =
    process.env.SMTP_FROM || 'FreshCart <customerservices@freshcart.co.ke>';

  await transporter.sendMail({
    from,
    to,
    subject: 'Reset your FreshCart password',
    text: `Hello ${fullName},

We received a request to reset your FreshCart password.

Use this link to choose a new password:
${resetUrl}

This link expires in 30 minutes and can only be used once.

If you did not request this change, you can ignore this email.

FreshCart Customer Support`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#333">
        <h2 style="color:#16834a">FreshCart Password Reset</h2>
        <p>Hello ${escapeHtml(fullName)},</p>
        <p>We received a request to reset your FreshCart password.</p>
        <p>
          <a href="${escapeHtml(resetUrl)}"
             style="display:inline-block;background:#16834a;color:white;padding:13px 22px;text-decoration:none;border-radius:6px">
            Reset My Password
          </a>
        </p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you did not request this change, you can safely ignore this email.</p>
        <p>FreshCart Customer Support</p>
      </div>
    `
  });
}

async function sendVerificationEmail(to, fullName, code) {
  if (!isConfigured()) {
    throw new Error('Email service is not configured.');
  }

  const port = Number(process.env.SMTP_PORT || 587);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Verify your FreshCart account',
    text: `Hello ${fullName},

Your FreshCart verification code is: ${code}

This code expires in 10 minutes.

FreshCart Customer Support`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#333">
        <h2 style="color:#16834a">Welcome to FreshCart!</h2>
        <p>Hello ${escapeHtml(fullName)},</p>
        <p>Your email verification code is:</p>
        <h1 style="letter-spacing:8px;color:#16834a">${escapeHtml(code)}</h1>
        <p>This code expires in 10 minutes.</p>
        <p>FreshCart Customer Support</p>
      </div>
    `
  });
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  isConfigured
};
