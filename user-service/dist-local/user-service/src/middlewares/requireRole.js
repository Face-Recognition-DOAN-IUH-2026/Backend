"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
const shared_1 = require("../../../shared");
const config_1 = require("../config");
const auth = (0, shared_1.createAuth)({
    jwtSecret: config_1.config.jwtSecret,
    jwtAudience: config_1.config.jwtAudience,
    jwtIssuer: config_1.config.jwtIssuer,
});
function requireRole(...roles) {
    return (req, res, next) => {
        auth(req, res, () => {
            if (!req.user) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            if (!roles.includes(req.user.role)) {
                res.status(403).json({ error: 'Insufficient permissions' });
                return;
            }
            next();
        });
    };
}
