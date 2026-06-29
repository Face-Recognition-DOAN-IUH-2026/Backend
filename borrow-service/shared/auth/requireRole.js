"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
function requireRole(roles) {
    return (req, res, next) => {
        const role = req.user?.role || '';
        if (!roles.includes(role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    };
}
