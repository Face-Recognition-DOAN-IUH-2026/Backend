"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditContextMiddleware = auditContextMiddleware;
exports.getAuditContext = getAuditContext;
const async_hooks_1 = require("async_hooks");
const storage = new async_hooks_1.AsyncLocalStorage();
function auditContextMiddleware(req, _res, next) {
    const ctx = {
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
        requestPath: req.path,
    };
    storage.run(ctx, () => next());
}
function getAuditContext() {
    return storage.getStore();
}
