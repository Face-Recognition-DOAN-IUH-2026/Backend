"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
exports.requireRole = requireRole;
const shared_1 = require("../../shared");
const config_1 = require("../config");
exports.auth = (0, shared_1.createAuth)({
    jwtSecret: config_1.config.jwtSecret,
    jwtAudience: config_1.config.jwtAudience,
    jwtIssuer: config_1.config.jwtIssuer,
    errorKey: 'detail',
    noTokenMessage: 'Invalid or expired token',
    invalidTokenMessage: 'Invalid or expired token',
});
function requireRole(roles, detail) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403).json({ detail });
            return;
        }
        next();
    };
}
