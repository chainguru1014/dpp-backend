const Company = require('../models/companyModel');
const AppError = require('../utils/appError');

// Use after protect. The platform super admin only (the built-in "admin"
// company account, role 'super').
exports.requireSuperAdmin = async (req: any, res: any, next: any) => {
    try {
        if (req.user?.actorKind !== 'Company') {
            return next(new AppError(403, 'fail', 'Only the Yometel admin can do this'));
        }
        const company = await Company.findById(req.user.id).select('role name').lean();
        if (!company || (company.role !== 'super' && company.name !== 'admin')) {
            return next(new AppError(403, 'fail', 'Only the Yometel admin can do this'));
        }
        req.isSuperAdmin = true;
        next();
    } catch (error) {
        next(error);
    }
};

// Use after protect, on /company/:id. The super admin may change any company;
// a company account may change its own profile, but never its role, its
// approval or its sign-in secrets.
const PROTECTED_FIELDS = ['role', 'isVerified', 'password', 'otpCode', 'otpExpiresAt', 'otpAttempts', 'otpResendAt', 'googleId', 'appleId', 'privateKey', 'wallet', 'emailVerified'];
exports.requireSuperOrSelf = async (req: any, res: any, next: any) => {
    try {
        if (req.user?.actorKind !== 'Company') {
            return next(new AppError(403, 'fail', 'You do not have permission to change this company'));
        }
        const me = await Company.findById(req.user.id).select('role name').lean();
        const isSuper = !!me && (me.role === 'super' || me.name === 'admin');
        if (!isSuper && String(req.user.id) !== String(req.params.id)) {
            return next(new AppError(403, 'fail', 'You do not have permission to change this company'));
        }
        if (req.body && typeof req.body === 'object') {
            // Nobody sets a role or sign-in secrets through this route; a
            // company also can't approve itself or change its sign-in email.
            const blocked = isSuper ? ['role', 'password', 'otpCode', 'privateKey'] : [...PROTECTED_FIELDS, 'email', 'allowedEmailDomains', 'companyType'];
            blocked.forEach((key) => { delete req.body[key]; });
        }
        req.isSuperAdmin = isSuper;
        next();
    } catch (error) {
        next(error);
    }
};
