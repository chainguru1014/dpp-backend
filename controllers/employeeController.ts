const Employee = require('../models/employeeModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const { emailDomain, hashEmail } = require('../utils/pii');
const { appendAuditLog } = require('../utils/employeeAuditLog');
const { getNextSequence } = require('../models/counterModel');
const { formatTerminalId } = require('../utils/idFormat');

const buildEmployeeResponse = (employee: any) => ({
    _id: employee._id,
    email: employee.email || null,
    emailDomain: employee.emailDomain,
    company_id: employee.company_id?._id || employee.company_id,
    companyName: employee.company_id?.name,
    employeeCode: employee.employeeCode,
    name: employee.name || null,
    role: employee.role,
    employeeType: employee.employeeType,
    isActive: employee.isActive,
    terminalId: employee.terminalId,
    lastLoginAt: employee.lastLoginAt,
    createdAt: employee.createdAt
});

/** Resolves the Company doc a roster request (invite/list/update/remove) acts
 * against, and whether the requester may WRITE to it. Mirrors
 * companyController.resolveProcessStepsActor's actorKind branching: a Company
 * actor manages its own roster directly; an Employee actor may only manage
 * their own company's roster, and only if they're a Supervisor. */
const resolveRosterActor = async (req: any) => {
    if (req.user.actorKind === 'Company') {
        const company = await Company.findById(req.user.id).select('role allowedEmailDomains');
        if (!company) {
            return { company: null, canWrite: false };
        }
        return { company, canWrite: true };
    }
    const employee = await Employee.findById(req.user.id).select('company_id employeeType');
    if (!employee) {
        return { company: null, canWrite: false };
    }
    const company = await Company.findById(employee.company_id).select('role allowedEmailDomains');
    if (!company) {
        return { company: null, canWrite: false };
    }
    return { company, canWrite: employee.employeeType === 'supervisor' };
};

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
        const employeeType = req.body?.employeeType || 'working_employee';
        if (!email || !email.includes('@')) {
            return res.status(400).json({ status: 'fail', message: 'A valid email is required' });
        }
        if (!['staff', 'manager', 'admin'].includes(role)) {
            return res.status(400).json({ status: 'fail', message: 'role must be staff, manager, or admin' });
        }
        if (!['working_employee', 'supervisor'].includes(employeeType)) {
            return res.status(400).json({ status: 'fail', message: 'employeeType must be working_employee or supervisor' });
        }

        // Must include allowedEmailDomains — resolveInviteCompany returns this
        // same doc as `company` for a non-super requester, and the domain
        // check right below reads company.allowedEmailDomains off it.
        const { company: requester, canWrite } = await resolveRosterActor(req);
        if (!requester) {
            return res.status(404).json({ status: 'fail', message: 'Company not found' });
        }
        if (!canWrite) {
            return res.status(403).json({ status: 'fail', message: 'Only a Supervisor or company admin may manage staff' });
        }
        // A Supervisor (actorKind 'Employee' reaching this point is always one —
        // canWrite above already excludes a working_employee) may only manage
        // working employees, never provision or edit another Supervisor.
        if (req.user.actorKind === 'Employee' && employeeType === 'supervisor') {
            return res.status(403).json({ status: 'fail', message: 'A Supervisor may only manage working employees, not other Supervisors' });
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
        if (employee && req.user.actorKind === 'Employee' && employee.employeeType === 'supervisor') {
            return res.status(403).json({ status: 'fail', message: 'A Supervisor may only manage working employees, not other Supervisors' });
        }

        let isNew = false;
        if (employee) {
            employee.email = email;
            employee.role = role;
            employee.employeeType = employeeType;
            employee.employeeCode = req.body?.employeeCode || employee.employeeCode;
            employee.name = req.body?.name || employee.name;
            employee.isActive = true;
            await employee.save();
        } else {
            isNew = true;
            const terminalSeq = await getNextSequence(`terminal:${company._id}`);
            employee = await Employee.create({
                email,
                emailHash,
                emailDomain: domain,
                company_id: company._id,
                employeeCode: req.body?.employeeCode,
                name: req.body?.name,
                role,
                employeeType,
                isActive: true,
                terminalId: formatTerminalId(terminalSeq)
            });
        }

        await appendAuditLog(employee._id, isNew ? 'provisioned' : 'updated', { role, employeeType, by: String(req.user.id) }, req.ip);

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
        const { company: requester, canWrite } = await resolveRosterActor(req);
        if (!requester) {
            return next(new AppError(404, 'fail', 'Company not found'));
        }
        if (!canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may view staff'));
        }
        const filter: any = requester.role === 'super' ? {} : { company_id: requester._id };
        // A Supervisor only manages working employees, so other Supervisors
        // (including themselves) never appear in their own roster view.
        if (req.user.actorKind === 'Employee') {
            filter.employeeType = 'working_employee';
        }
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

        const { company: requester, canWrite } = await resolveRosterActor(req);
        if (!requester) {
            return next(new AppError(404, 'fail', 'Company not found'));
        }
        if (!canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may manage staff'));
        }
        if (requester.role !== 'super' && String(employee.company_id) !== String(requester._id)) {
            return next(new AppError(403, 'fail', 'You do not have permission to manage this employee'));
        }
        if (req.user.actorKind === 'Employee' && employee.employeeType === 'supervisor') {
            return next(new AppError(403, 'fail', 'A Supervisor may only manage working employees, not other Supervisors'));
        }

        const { role, employeeType, isActive, employeeCode, name, email } = req.body || {};
        if (req.user.actorKind === 'Employee' && employeeType === 'supervisor') {
            return res.status(403).json({ status: 'fail', message: 'A Supervisor may not promote an employee to Supervisor' });
        }
        if (role !== undefined) {
            if (!['staff', 'manager', 'admin'].includes(role)) {
                return res.status(400).json({ status: 'fail', message: 'role must be staff, manager, or admin' });
            }
            employee.role = role;
        }
        if (employeeType !== undefined) {
            if (!['working_employee', 'supervisor'].includes(employeeType)) {
                return res.status(400).json({ status: 'fail', message: 'employeeType must be working_employee or supervisor' });
            }
            employee.employeeType = employeeType;
        }
        if (email !== undefined) {
            const normalized = String(email).trim().toLowerCase();
            if (!normalized || !normalized.includes('@')) {
                return res.status(400).json({ status: 'fail', message: 'A valid email is required' });
            }
            const newHash = hashEmail(normalized);
            if (newHash !== employee.emailHash) {
                const clash = await Employee.findOne({ emailHash: newHash, _id: { $ne: employee._id } });
                if (clash) {
                    return res.status(409).json({ status: 'fail', message: 'This email is already provisioned for another employee' });
                }
            }
            employee.email = normalized;
            employee.emailHash = newHash;
            employee.emailDomain = emailDomain(normalized);
        }
        if (isActive !== undefined) employee.isActive = !!isActive;
        if (employeeCode !== undefined) employee.employeeCode = employeeCode;
        if (name !== undefined) employee.name = name;
        await employee.save();

        await appendAuditLog(employee._id, 'updated', { role: employee.role, employeeType: employee.employeeType, isActive: employee.isActive, by: String(req.user.id) }, req.ip);

        return res.status(200).json({ status: 'success', data: buildEmployeeResponse(employee) });
    } catch (error) {
        next(error);
    }
};

// DELETE /employee-auth/employees/:id — removes an employee's roster entry.
// Ownership-checked the same way update() is.
exports.remove = async (req: any, res: any, next: any) => {
    try {
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return next(new AppError(404, 'fail', 'Employee not found'));
        }

        const { company: requester, canWrite } = await resolveRosterActor(req);
        if (!requester) {
            return next(new AppError(404, 'fail', 'Company not found'));
        }
        if (!canWrite) {
            return next(new AppError(403, 'fail', 'Only a Supervisor or company admin may manage staff'));
        }
        if (requester.role !== 'super' && String(employee.company_id) !== String(requester._id)) {
            return next(new AppError(403, 'fail', 'You do not have permission to manage this employee'));
        }
        if (req.user.actorKind === 'Employee' && String(employee._id) === String(req.user.id)) {
            return next(new AppError(400, 'fail', 'You cannot remove your own account'));
        }
        if (req.user.actorKind === 'Employee' && employee.employeeType === 'supervisor') {
            return next(new AppError(403, 'fail', 'A Supervisor may only manage working employees, not other Supervisors'));
        }

        await Employee.deleteOne({ _id: employee._id });
        await appendAuditLog(employee._id, 'removed', { by: String(req.user.id) }, req.ip);

        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};
