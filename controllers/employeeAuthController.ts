const Employee = require('../models/employeeModel');
const AppError = require('../utils/appError');
const { signJwt } = require('../utils/authShared');
const { normalizeEmail, emailDomain, hashEmail } = require('../utils/pii');
const { generateOtp, sendOtpEmail, OTP_EXPIRY_MINUTES } = require('../utils/otp');
const { appendAuditLog } = require('../utils/employeeAuditLog');

const buildEmployeeResponse = (employee: any) => ({
    _id: employee._id,
    emailDomain: employee.emailDomain,
    company_id: employee.company_id,
    employeeCode: employee.employeeCode,
    role: employee.role,
    isActive: employee.isActive,
    lastLoginAt: employee.lastLoginAt
});

// POST /employee-auth/otp/request — corporate-SSO entry point. Admin-provisioned
// only: this only succeeds for an emailHash a company admin already created via
// employeeController.invite. The raw email exists only for the duration of this
// request (to compute the hash and send the OTP mail); nothing below ever
// writes it to disk — see utils/pii.ts for the one-way hash used everywhere else.
exports.otpRequest = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return res.status(400).json({ status: 'fail', message: 'email is required' });
        }

        const domain = emailDomain(email);
        const emailHash = hashEmail(email);

        // Admin-provisioned only: a company admin must have already created this
        // employee's record (see employeeController.invite) before they can ever
        // request a code. We deliberately don't distinguish "wrong domain" from
        // "not provisioned" in the response — both are the same generic message,
        // so this endpoint can't be used to enumerate which domains or addresses
        // are recognized.
        const employee = await Employee.findOne({ emailHash }).select('+otpCode +otpExpiresAt +otpAttempts +otpResendAt');
        if (!employee || employee.emailDomain !== domain) {
            return res.status(403).json({ status: 'fail', message: 'This email is not authorized for staff sign-in. Contact your company admin.' });
        }

        if (employee.otpResendAt && employee.otpResendAt.getTime() > Date.now()) {
            return res.status(429).json({ status: 'fail', message: 'Please wait before requesting another code' });
        }

        if (!employee.isActive) {
            return res.status(403).json({ status: 'fail', message: 'This staff account has been deactivated' });
        }

        const code = generateOtp();
        const now = Date.now();
        const otpFields = {
            otpCode: code,
            otpExpiresAt: new Date(now + OTP_EXPIRY_MINUTES * 60 * 1000),
            otpResendAt: new Date(now + 60 * 1000),
            otpAttempts: 0
        };

        Object.assign(employee, otpFields);
        await employee.save();

        try {
            await sendOtpEmail(email, code);
        } catch (err) {
            console.error('sendOtpEmail failed:', err);
            return next(new AppError(502, 'fail', 'Failed to send verification email'));
        }

        if (process.env.NODE_ENV !== 'production') {
            console.log(`[dev-only] Employee OTP code for domain ${domain}: ${code}`);
        }

        return res.status(200).json({ message: 'Code sent' });
    } catch (error) {
        next(error);
    }
};

// POST /employee-auth/otp/verify — same code/attempt/expiry rules as the
// consumer OTP flow, but resolves by emailHash and never touches a User/Company
// email field. On success, appends a 'login' row to the tamper-evident audit log.
exports.otpVerify = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || '').trim();
        if (!email || !code) {
            return res.status(400).json({ status: 'fail', message: 'email and code are required' });
        }

        const emailHash = hashEmail(email);
        const employee = await Employee.findOne({ emailHash }).select('+otpCode +otpExpiresAt +otpAttempts +otpResendAt');

        if (!employee || !employee.otpCode || !employee.otpExpiresAt) {
            return res.status(400).json({ status: 'fail', message: 'No pending code for this email. Request a new one.' });
        }

        if (!employee.isActive) {
            return res.status(403).json({ status: 'fail', message: 'This staff account has been deactivated' });
        }

        if (employee.otpExpiresAt.getTime() < Date.now()) {
            employee.otpCode = undefined;
            employee.otpExpiresAt = undefined;
            employee.otpAttempts = 0;
            employee.otpResendAt = undefined;
            await employee.save();
            return res.status(400).json({ status: 'fail', message: 'Code expired. Request a new one.' });
        }

        if (employee.otpCode !== code) {
            employee.otpAttempts = (employee.otpAttempts || 0) + 1;
            if (employee.otpAttempts >= 5) {
                employee.otpCode = undefined;
                employee.otpExpiresAt = undefined;
                employee.otpAttempts = 0;
                employee.otpResendAt = undefined;
                await employee.save();
                return res.status(400).json({ status: 'fail', message: 'Too many attempts. Request a new code.' });
            }
            await employee.save();
            return res.status(400).json({ status: 'fail', message: 'Invalid code' });
        }

        employee.otpCode = undefined;
        employee.otpExpiresAt = undefined;
        employee.otpAttempts = 0;
        employee.otpResendAt = undefined;
        employee.lastLoginAt = new Date();
        await employee.save();

        await appendAuditLog(employee._id, 'login', { emailDomain: employee.emailDomain }, req.ip);

        const token = signJwt({ id: employee._id, actorKind: 'Employee', role: employee.role });

        return res.status(200).json({
            status: 'success',
            token,
            employee: buildEmployeeResponse(employee),
            actorKind: 'Employee',
            message: 'Login successful'
        });
    } catch (error) {
        next(error);
    }
};
