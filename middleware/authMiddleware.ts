const jwt = require('jsonwebtoken');
const AppError = require('../utils/appError');

/**
 * Verifies the `Authorization: Bearer <jwt>` header and attaches
 * req.user = { id, actorKind, name } for downstream handlers.
 * 401s on missing/invalid/expired tokens. This is the first real
 * JWT-verification middleware in the codebase — previously-mounted routes
 * that look protected (comments like "protect all routes after this
 * middleware") were not actually enforcing anything.
 */
exports.protect = (req: any, res: any, next: any) => {
    try {
        let token;
        const authHeader = req.headers && req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }

        if (!token) {
            return next(new AppError(401, 'fail', 'You are not logged in. Please log in to get access.'));
        }

        const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            id: decoded.id,
            actorKind: decoded.actorKind || 'User',
            name: decoded.name,
            // Only meaningful for actorKind 'Employee' — carries the RBAC role
            // (staff/manager/admin) so restrictToEmployeeRole can check it
            // without a DB round-trip on every request.
            role: decoded.role
        };
        next();
    } catch (err: any) {
        // The client only ever sees the generic message below (no reason to tell
        // a caller *why* their token was rejected), but "expired" (re-login fixes
        // it), "invalid signature" (JWT_SECRET mismatch between whatever signed
        // this token and this process — a real server misconfig), and "malformed"
        // (garbage/missing token) need very different fixes, so log which one
        // server-side to make that diagnosable from the process logs.
        console.error('JWT verify failed:', err?.name, '-', err?.message);
        return next(new AppError(401, 'fail', 'Invalid or expired token'));
    }
};

/** Restricts a route to one or more actor kinds, e.g. restrictTo('Company'). */
exports.restrictTo = (...kinds: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !kinds.includes(req.user.actorKind)) {
        return next(new AppError(403, 'fail', 'You do not have permission to perform this action'));
    }
    next();
};

/** Restricts a route to Employee actors holding one of the given RBAC roles,
 * e.g. restrictToEmployeeRole('manager', 'admin'). */
exports.restrictToEmployeeRole = (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || req.user.actorKind !== 'Employee' || !roles.includes(req.user.role)) {
        return next(new AppError(403, 'fail', 'You do not have permission to perform this action'));
    }
    next();
};

/** Allows either an Employee holding one of `roles`, or any Company (brand
 * dashboard) actor — used for the audit-log view, which both a manager
 * checking it from the app and a brand admin checking it from the web
 * dashboard need to reach. Scoping to "this company's employees only"
 * happens in the controller, not here. */
exports.restrictToEmployeeRoleOrCompany = (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
        return next(new AppError(403, 'fail', 'You do not have permission to perform this action'));
    }
    if (req.user.actorKind === 'Company') {
        return next();
    }
    if (req.user.actorKind === 'Employee' && roles.includes(req.user.role)) {
        return next();
    }
    return next(new AppError(403, 'fail', 'You do not have permission to perform this action'));
};
