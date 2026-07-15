const Employee = require('../models/employeeModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const { emailDomain, hashEmail } = require('../utils/pii');
const { appendAuditLog } = require('../utils/employeeAuditLog');

const buildEmployeeResponse = (employee: any) => ({
    _id: employee._id,
    email: employee.email || null,
    emailDomain: employee.emailDomain,
    company_id: employee.company_id?._id || employee.company_id,
    companyName: employee.company_id?.name,
    employeeCode: employee.employeeCode,
    role: employee.role,
    isActive: employee.isActive,
    lastLoginAt: employee.lastLoginAt,
    createdAt: employee.createdAt
});

/** Determines which Company an invite should be provisioned under.
 * - A normal Company account may only provision into its own roster.
 * - The platform "super" account has no roster of its own, so instead of
 *   requiring a manually-picked target company, it auto-detects one by
 *   matching the invited email's domain against every registered company's
 *   Allowed Staff Email Domains (excluding super/admin accounts, which never
 *   take on staff of their own). */
const resolveInviteCompany = async (requester: any, domain: string) => {
    if (requester.role !== 'super') {
        return requester;
    }
    const target = await Company.findOne({ role: { $ne: 'super' }, allowedEmailDomains: domain });
    if (!target) {
        const err: any = new Error(`No registered company has ${domain} listed in its Allowed Staff Email Domains.`);
        err.statusCode = 400;
        throw err;
    }
    return target;
};

// POST /employee-auth/employees — admin-provisions a staff account. This is the
// ONLY way an Employee record gets created: employeeAuthController.otpRequest
// refuses to send a code for anyone not already provisioned here.
exports.invite = async (req: any, res: any, next: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const role = req.body?.role || 'staff';
        if (!email || !email.includes('@')) {
            return res.status(400).json({ status: 'fail', message: 'A valid email is required' });
        }
        if (!['staff', 'manager', 'admin'].includes(role)) {
            return res.status(400).json({ status: 'fail', message: 'role must be staff, manager, or admin' });
        }

        const requester = await Company.findById(req.user.id).select('role');
        if (!requester) {
            return res.status(404).json({ status: 'fail', message: 'Company not found' });
        }

        const domain = emailDomain(email);
        let company: any;
        try {
            company = await resolveInviteCompany(requester, domain);
        } catch (err: any) {
            return res.status(err.statusCode || 400).json({ status: 'fail', message: err.message });
        }

        if (!company.allowedEmailDomains || !company.allowedEmailDomains.includes(domain)) {
            return res.status(400).json({
                status: 'fail',
                message: `${domain} is not an allowed staff domain for this company. Add it to Allowed Staff Email Domains first.`
            });
        }

        const emailHash = hashEmail(email);
        let employee = await Employee.findOne({ emailHash });

        if (employee && String(employee.company_id) !== String(company._id)) {
            return res.status(409).json({ status: 'fail', message: 'This email is already provisioned under a different company' });
        }

        let isNew = false;
        if (employee) {
            employee.email = email;
            employee.role = role;
            employee.employeeCode = req.body?.employeeCode || employee.employeeCode;
            employee.isActive = true;
            await employee.save();
        } else {
            isNew = true;
            employee = await Employee.create({
                email,
                emailHash,
                emailDomain: domain,
                company_id: company._id,
                employeeCode: req.body?.employeeCode,
                role,
                isActive: true
            });
        }

        await appendAuditLog(employee._id, isNew ? 'provisioned' : 'updated', { role, by: String(req.user.id) }, req.ip);

        return res.status(200).json({ status: 'success', data: buildEmployeeResponse(employee) });
    } catch (error: any) {
        if (error.statusCode) {
            return next(new AppError(error.statusCode, 'fail', error.message));
        }
        next(error);
    }
};

// GET /employee-auth/employees — roster for the caller's own company. The
// platform "super" account has no roster of its own, so it always sees every
// company's employees instead (each row's company name comes along via populate).
exports.list = async (req: any, res: any, next: any) => {
    try {
        const requester = await Company.findById(req.user.id).select('role');
        if (!requester) {
            return next(new AppError(404, 'fail', 'Company not found'));
        }
        const filter = requester.role === 'super' ? {} : { company_id: requester._id };
        const employees = await Employee.find(filter)
            .sort({ createdAt: -1 })
            .populate({ path: 'company_id', select: 'name' });
        return res.status(200).json({ status: 'success', data: employees.map(buildEmployeeResponse) });
    } catch (error) {
        next(error);
    }
};

// PATCH /employee-auth/employees/:id — update role/employeeCode/isActive.
// Ownership-checked: a Company (unless "super") may only edit its own employees.
exports.update = async (req: any, res: any, next: any) => {
    try {
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return next(new AppError(404, 'fail', 'Employee not found'));
        }

        const requester = await Company.findById(req.user.id).select('role');
        if (!requester) {
            return next(new AppError(404, 'fail', 'Company not found'));
        }
        if (requester.role !== 'super' && String(employee.company_id) !== String(requester._id)) {
            return next(new AppError(403, 'fail', 'You do not have permission to manage this employee'));
        }

        const { role, isActive, employeeCode } = req.body || {};
        if (role !== undefined) {
            if (!['staff', 'manager', 'admin'].includes(role)) {
                return res.status(400).json({ status: 'fail', message: 'role must be staff, manager, or admin' });
            }
            employee.role = role;
        }
        if (isActive !== undefined) employee.isActive = !!isActive;
        if (employeeCode !== undefined) employee.employeeCode = employeeCode;
        await employee.save();

        await appendAuditLog(employee._id, 'updated', { role: employee.role, isActive: employee.isActive, by: String(req.user.id) }, req.ip);

        return res.status(200).json({ status: 'success', data: buildEmployeeResponse(employee) });
    } catch (error) {
        next(error);
    }
};
