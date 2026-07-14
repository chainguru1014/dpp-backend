const Employee = require('../models/employeeModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const { emailDomain, hashEmail } = require('../utils/pii');
const { appendAuditLog } = require('../utils/employeeAuditLog');

const buildEmployeeResponse = (employee: any) => ({
    _id: employee._id,
    emailDomain: employee.emailDomain,
    company_id: employee.company_id,
    employeeCode: employee.employeeCode,
    role: employee.role,
    isActive: employee.isActive,
    lastLoginAt: employee.lastLoginAt,
    createdAt: employee.createdAt
});

/** A Company account manages its own roster only, unless it's the platform
 * "super" account, which may act on behalf of any company via body.company_id
 * / query.companyId. Returns the resolved Company document. */
const resolveTargetCompany = async (req: any) => {
    const requester = await Company.findById(req.user.id).select('role');
    if (!requester) {
        const err: any = new Error('Company not found');
        err.statusCode = 404;
        throw err;
    }
    const requestedCompanyId = req.body?.company_id || req.query?.companyId;
    if (requester.role === 'super' && requestedCompanyId) {
        const target = await Company.findById(requestedCompanyId);
        if (!target) {
            const err: any = new Error('Target company not found');
            err.statusCode = 404;
            throw err;
        }
        return target;
    }
    return requester;
};

// POST /employee-auth/employees — admin-provisions a staff account. This is the
// ONLY way an Employee record gets created: employeeAuthController.otpRequest
// refuses to send a code for anyone not already provisioned here. The raw
// email is used only to validate the domain and compute the hash — never stored.
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

        const company = await resolveTargetCompany(req);
        const domain = emailDomain(email);
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
            employee.role = role;
            employee.employeeCode = req.body?.employeeCode || employee.employeeCode;
            employee.isActive = true;
            await employee.save();
        } else {
            isNew = true;
            employee = await Employee.create({
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

// GET /employee-auth/employees — roster for the caller's own company (or a
// specific company via ?companyId= if the caller is the platform "super" account).
exports.list = async (req: any, res: any, next: any) => {
    try {
        const company = await resolveTargetCompany(req);
        const employees = await Employee.find({ company_id: company._id }).sort({ createdAt: -1 });
        return res.status(200).json({ status: 'success', data: employees.map(buildEmployeeResponse) });
    } catch (error: any) {
        if (error.statusCode) {
            return next(new AppError(error.statusCode, 'fail', error.message));
        }
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
