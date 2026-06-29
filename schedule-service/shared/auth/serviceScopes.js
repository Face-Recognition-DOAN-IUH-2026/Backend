"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_SCOPES = void 0;
exports.getScopesForService = getScopesForService;
exports.hasScope = hasScope;
exports.SERVICE_SCOPES = {
    'borrow-service': [
        'users:read',
        'access:read',
        'access:write',
        'notifications:send',
    ],
    'user-service': [
        'access:read',
        'access:write',
        'notifications:send',
        'faces:read',
        'faces:write',
        'borrows:read',
    ],
    'access-service': [
        'users:read',
    ],
    'schedule-service': [
        'users:read',
        'users:read:staff',
    ],
    'automation-service': [
        'users:read',
        'borrows:read',
        'schedules:read',
        'access:read',
        'access:write',
        'notifications:send',
    ],
    'ai-service': [
        'borrows:read',
        'borrows:write',
        'users:read',
        'schedules:read',
        'access:read',
    ],
    'face-recognition-service': [
        'users:read',
        'users:write',
        'access:read',
        'access:write',
    ],
};
function getScopesForService(serviceName) {
    return exports.SERVICE_SCOPES[serviceName] || [];
}
function hasScope(serviceName, scope) {
    const scopes = getScopesForService(serviceName);
    return scopes.includes(scope);
}
