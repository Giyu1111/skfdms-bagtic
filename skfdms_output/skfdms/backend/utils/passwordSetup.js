const crypto = require('crypto');
const nodemailer = require('nodemailer');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function createPasswordSetupToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}

function passwordSetupUrl(req, token) {
  const configuredBaseUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
  const baseUrl = configuredBaseUrl || requestBaseUrl;
  return `${baseUrl}/pages/create-password?token=${encodeURIComponent(token)}`;
}

async function sendPasswordSetupEmail({ to, name, setupUrl }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return false;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Set your SK-FDMS password',
    text: `Hello ${name},\n\nYour SK-FDMS registration was approved. Set your password using this one-time link within 24 hours:\n${setupUrl}\n\nIf you did not request this account, you may ignore this email.`,
  });
  return true;
}

module.exports = { createPasswordSetupToken, passwordSetupUrl, sendPasswordSetupEmail };
