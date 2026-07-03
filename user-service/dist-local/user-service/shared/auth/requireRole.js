"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
function requireRole(roles, ...moreRoles) {
    const roleList = Array.isArray(roles) ? roles : [roles, ...moreRoles];
    return (req, res, next) => {
        const role = req.user?.role || '';
        if (!roleList.includes(role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
}
