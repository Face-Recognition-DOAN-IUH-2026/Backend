"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInternalAuth = createInternalAuth;
const serviceToken_1 = require("./serviceToken");
function logInternalAccess(serviceName, endpoint, identity, success) {
    const fingerprint = identity ? `${identity.substring(0, 4)}...${identity.substring(identity.length - 4)}` : 'none';
    const timestamp = new Date().toISOString();
    const status = success ? 'SUCCESS' : 'FAILED';
    console.log(`[InternalAudit] ${timestamp} ${serviceName} ${endpoint} identity=${fingerprint} status=${status}`);
}
function createInternalAuth(config) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const serviceToken = (0, serviceToken_1.verifyServiceToken)(token, config.jwtSecret);
                req.service = serviceToken;
                logInternalAccess(config.serviceName, req.path, `jwt:${serviceToken.sub}`, true);
                next();
                return;
            }
            catch {
                logInternalAccess(config.serviceName, req.path, 'jwt-invalid', false);
                res.status(403).json({ error: 'Invalid service token' });
                return;
            }
        }
        logInternalAccess(config.serviceName, req.path, 'no-token', false);
        res.status(403).json({ error: 'Missing Authorization header' });
    };
}
