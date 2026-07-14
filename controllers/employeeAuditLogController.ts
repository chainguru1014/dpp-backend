const EmployeeAuditLog = require('../models/employeeAuditLogModel');
const Employee = require('../models/employeeModel');
const Company = require('../models/companyModel');

/** Resolves which company_id (if any) the requester is scoped to. Returns
 * `null` to mean "no scoping — see every company's logs" (platform super admin
 * only); otherwise every log returned must belong to an employee of that company. */
const resolveCompanyScope = async (req: any) => {
    if (req.user.actorKind === 'Company') {
        const company = await Company.findById(req.user.id).select('role');
        if (company && company.role === 'super') {
            return null;
        }
        return req.user.id;
    }
    // Employee (manager/admin RBAC already enforced by the route middleware):
    // scoped to their own company's employees, never the whole platform.
    const employee = await Employee.findById(req.user.id).select('company_id');
    return employee ? employee.company_id : undefined;
};

// GET /employee-auth/audit-log — reachable by an Employee manager/admin (own
// company only) or any Company/brand dashboard account (own company only,
// unless it's the platform "super" account). Read-only by design: no
// update/delete route exists for this collection anywhere in the codebase.
exports.list = async (req: any, res: any, next: any) => {
    try {
        const page = Math.max(1, Number(req.query?.page) || 1);
        const limit = Math.min(100, Number(req.query?.limit) || 50);

        const companyScope = await resolveCompanyScope(req);
        const filter: any = {};

        if (companyScope !== null) {
            const scopedEmployeeIds = await Employee.find({ company_id: companyScope }).distinct('_id');
            filter.employee_id = { $in: scopedEmployeeIds };
        }
        if (req.query?.employeeId) {
            filter.employee_id = req.query.employeeId;
        }

        const [logs, total] = await Promise.all([
            EmployeeAuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .populate({ path: 'employee_id', select: 'emailDomain company_id role employeeCode', model: Employee }),
            EmployeeAuditLog.countDocuments(filter)
        ]);

        return res.status(200).json({
            status: 'success',
            data: logs,
            pagination: { page, limit, total }
        });
    } catch (error) {
        next(error);
    }
};
