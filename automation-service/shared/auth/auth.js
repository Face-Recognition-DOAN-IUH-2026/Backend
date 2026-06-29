"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuth = createAuth;
const decodeToken_1 = require("./decodeToken");
function createAuth(config) {
    const key = config.errorKey || 'error';
    const noTokenMsg = config.noTokenMessage || 'No token provided';
    const invalidTokenMsg = config.invalidTokenMessage || 'Invalid or expired token';
    return (req, res, next) => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            res.status(401).json({ [key]: noTokenMsg });
            return;
        }
        const token = header.split(' ')[1];
        try {
            const user = (0, decodeToken_1.decodeToken)(token, config);
            req.user = { ...user, token };
            next();
        }
        catch {
            res.status(401).json({ [key]: invalidTokenMsg });
        }
    };
}
