const crypto = require('crypto');
const { mailTransporter, mailFrom, infoRow, emailLayout } = require('./mailer');

/** 6-digit numeric OTP code, e.g. "042817". */
const generateOtp = () => String(crypto.randomInt(100000, 999999));

/** Email the OTP code to the given address using the shared branded layout. */
const sendOtpEmail = async (email: string, code: string) => {
    const inner = `
        <p>Hello,</p>
        <p>Your one-time sign-in code is:</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          ${infoRow('Code', `<span style="font-size:22px;letter-spacing:4px">${code}</span>`)}
        </table>
        <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`;
    const text = `Your one-time sign-in code is ${code}. It expires in 10 minutes.`;
    await mailTransporter().sendMail({
        from: mailFrom(),
        to: email,
        replyTo: process.env.SMTP_FROM || process.env.SMTP_USER || undefined,
        subject: 'Your sign-in code',
        text,
        html: emailLayout('Your sign-in code', inner)
    });
};

module.exports = {
    generateOtp,
    sendOtpEmail
};
