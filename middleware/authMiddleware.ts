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
            name: decoded.name
        };
        next();
    } catch (err) {
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
