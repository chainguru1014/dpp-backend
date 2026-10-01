const { mailTransporter, mailFrom, emailLayout, ctaButton } = require('./mailer');

// Where brands and their staff sign in on the web.
const ADMIN_PANEL_URL = (process.env.ADMIN_PANEL_URL || 'https://admin.innosynch.com').replace(/\/+$/, '');

const escapeHtml = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Tells a newly added Supervisor or working employee that they have an
 * account, where to sign in and how (a code sent to this same address — there
 * is no password). Without this, someone added in the admin panel has no way
 * to know. Callers treat it as best-effort: a failed email must never undo
 * the account that was just created.
 */
const sendWelcomeEmail = async ({ to, name, companyName, employeeType }: {
    to: string;
    name?: string;
    companyName?: string;
    employeeType: 'supervisor' | 'working_employee';
}) => {
    const company = escapeHtml(companyName || 'your company');
    const greeting = name ? `Hello ${escapeHtml(name)},` : 'Hello,';
    const isSupervisor = employeeType === 'supervisor';

    const steps = isSupervisor
        ? `<ol style="padding-left:20px;margin:12px 0">
             <li>Open the product management portal with the button below.</li>
             <li>Enter this email address. We send you a 6-digit code; there is no password.</li>
             <li>Add your first product, then create and print its labels. The dashboard shows each step.</li>
           </ol>`
        : `<ol style="padding-left:20px;margin:12px 0">
             <li>Open the Yometel DPP app on your phone.</li>
             <li>Sign in with this email address. We send you a 6-digit code; there is no password.</li>
             <li>Choose a work step and scan the product's label.</li>
           </ol>
           <p>You can also see your recorded work on the web with the button below.</p>`;

    const inner = `
        <p>${greeting}</p>
        <p>${isSupervisor
            ? `An account has been created for you to manage <b>${company}</b> on Yometel DPP (Digital Product Passport).`
            : `You have been added to <b>${company}</b> on Yometel DPP (Digital Product Passport).`}</p>
        ${steps}
        ${ctaButton(`${ADMIN_PANEL_URL}/admin`, isSupervisor ? 'Open the portal' : 'Open on the web')}
        <p style="color:#7a8aa3;font-size:13px">If you were not expecting this, you can ignore this email. Nothing happens until you sign in.</p>`;

    const text = isSupervisor
        ? `An account has been created for you to manage ${companyName || 'your company'} on Yometel DPP. Sign in at ${ADMIN_PANEL_URL}/admin with this email address; we send you a 6-digit code, there is no password.`
        : `You have been added to ${companyName || 'your company'} on Yometel DPP. Open the Yometel DPP app and sign in with this email address; we send you a 6-digit code, there is no password. On the web: ${ADMIN_PANEL_URL}/admin`;

    await mailTransporter().sendMail({
        from: mailFrom(),
        to,
        replyTo: process.env.SMTP_FROM || process.env.SMTP_USER || undefined,
        subject: `Welcome to Yometel DPP${companyName ? ` — ${companyName}` : ''}`,
        text,
        html: emailLayout('Welcome to Yometel DPP', inner)
    });
};

module.exports = { sendWelcomeEmail };
