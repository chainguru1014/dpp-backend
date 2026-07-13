const nodemailer = require('nodemailer');

// Shared SMTP transporter + branded layout so every outgoing email (transfer
// invites, OTP codes, etc.) looks the same. Extracted from transferController.ts
// so other controllers (e.g. authController.ts) can reuse it without duplicating.
const mailTransporter = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
});

const mailFrom = () => {
    const addr = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@yometel.jp';
    return `"Yometel DPP" <${addr}>`;
};

const infoRow = (label: string, value: any) =>
    `<tr><td style="padding:6px 0;color:#7a8aa3;font-size:13px">${label}</td><td style="padding:6px 0;font-weight:600;color:#1f3361;text-align:right">${value || '-'}</td></tr>`;

// Branded outer shell shared by all emails.
const emailLayout = (title: string, innerHtml: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#f4f7fc;padding:24px;border-radius:16px">
    <div style="background:linear-gradient(135deg,#1f3361,#3d5c93);color:#fff;padding:22px 24px;border-radius:14px;text-align:center">
      <h2 style="margin:0;font-size:20px;letter-spacing:.3px">${title}</h2>
    </div>
    <div style="background:#fff;padding:24px;border-radius:14px;margin-top:12px;color:#33415c;line-height:1.6">
      ${innerHtml}
    </div>
    <p style="text-align:center;color:#7a8aa3;font-size:12px;margin-top:16px">Powered by Yometel DPP</p>
  </div>`;

const ctaButton = (href: string, label: string) =>
    `<p style="text-align:center;margin:24px 0">
       <a href="${href}" style="background:#1976d2;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;display:inline-block">${label}</a>
     </p>`;

module.exports = {
    mailTransporter,
    mailFrom,
    infoRow,
    emailLayout,
    ctaButton
};
