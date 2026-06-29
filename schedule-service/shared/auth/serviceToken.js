"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateServiceToken = generateServiceToken;
exports.verifyServiceToken = verifyServiceToken;
exports.getServiceToken = getServiceToken;
exports.createServiceAuthMiddleware = createServiceAuthMiddleware;
const jwt = __importStar(require("jsonwebtoken"));
function generateServiceToken(serviceName, scopes, secret, expiresInSeconds = 900) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: serviceName,
        scope: scopes,
        iat: now,
        exp: now + expiresInSeconds,
    };
    return jwt.sign(payload, secret);
}
function verifyServiceToken(token, secret) {
    const decoded = jwt.verify(token, secret);
    return {
        sub: decoded.sub,
        scope: decoded.scope,
        iat: decoded.iat,
        exp: decoded.exp,
    };
}
let cachedToken = null;
let cachedTokenExpiry = 0;
function getServiceToken(serviceName, secret) {
    const now = Math.floor(Date.now() / 1000);
    // Cache token for 5 minutes (refresh before expiry)
    if (cachedToken && cachedTokenExpiry > now + 60) {
        return cachedToken;
    }
    const { getScopesForService } = require('./serviceScopes');
    const scopes = getScopesForService(serviceName);
    cachedToken = generateServiceToken(serviceName, scopes, secret, 900);
    cachedTokenExpiry = now + 900;
    return cachedToken;
}
function createServiceAuthMiddleware(config) {
    return (req, res, next) => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No service token provided' });
            return;
        }
        const token = header.split(' ')[1];
        try {
            const serviceToken = verifyServiceToken(token, config.jwtSecret);
            // Check required scopes
            const missingScopes = config.requiredScopes.filter(scope => !serviceToken.scope.includes(scope));
            if (missingScopes.length > 0) {
                res.status(403).json({
                    error: 'Insufficient scope',
                    missing: missingScopes,
                });
                return;
            }
            req.service = serviceToken;
            next();
        }
        catch {
            res.status(401).json({ error: 'Invalid or expired service token' });
        }
    };
}
