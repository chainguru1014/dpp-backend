const Company = require('../models/companyModel');
const Employee = require('../models/employeeModel');

// Which company's products a signed-in brand account or staff member may see.
//   allowed: false  — not a brand/staff session (e.g. an app user)
//   companyId: null — every company (the platform super admin)
//   canWrite        — the company account itself, or a Supervisor
const resolveCompanyScope = async (req: any) => {
    if (req.user?.actorKind === 'Company') {
        const company = await Company.findById(req.user.id).select('role');
        if (!company) return { allowed: false, companyId: null, canWrite: false };
        return { allowed: true, companyId: company.role === 'super' ? null : company._id, canWrite: true };
    }
    if (req.user?.actorKind === 'Employee') {
        const employee = await Employee.findById(req.user.id).select('company_id employeeType');
        if (!employee) return { allowed: false, companyId: null, canWrite: false };
        return { allowed: true, companyId: employee.company_id, canWrite: employee.employeeType === 'supervisor' };
    }
    return { allowed: false, companyId: null, canWrite: false };
};

module.exports = { resolveCompanyScope };
