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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.hasScope = exports.getScopesForService = exports.SERVICE_SCOPES = exports.createServiceAuthMiddleware = exports.getServiceToken = exports.verifyServiceToken = exports.generateServiceToken = exports.createAuth = exports.createInternalAuth = exports.decodeToken = void 0;
var decodeToken_1 = require("./decodeToken");
Object.defineProperty(exports, "decodeToken", { enumerable: true, get: function () { return decodeToken_1.decodeToken; } });
var internalAuth_1 = require("./internalAuth");
Object.defineProperty(exports, "createInternalAuth", { enumerable: true, get: function () { return internalAuth_1.createInternalAuth; } });
var auth_1 = require("./auth");
Object.defineProperty(exports, "createAuth", { enumerable: true, get: function () { return auth_1.createAuth; } });
var serviceToken_1 = require("./serviceToken");
Object.defineProperty(exports, "generateServiceToken", { enumerable: true, get: function () { return serviceToken_1.generateServiceToken; } });
Object.defineProperty(exports, "verifyServiceToken", { enumerable: true, get: function () { return serviceToken_1.verifyServiceToken; } });
Object.defineProperty(exports, "getServiceToken", { enumerable: true, get: function () { return serviceToken_1.getServiceToken; } });
Object.defineProperty(exports, "createServiceAuthMiddleware", { enumerable: true, get: function () { return serviceToken_1.createServiceAuthMiddleware; } });
var serviceScopes_1 = require("./serviceScopes");
Object.defineProperty(exports, "SERVICE_SCOPES", { enumerable: true, get: function () { return serviceScopes_1.SERVICE_SCOPES; } });
Object.defineProperty(exports, "getScopesForService", { enumerable: true, get: function () { return serviceScopes_1.getScopesForService; } });
Object.defineProperty(exports, "hasScope", { enumerable: true, get: function () { return serviceScopes_1.hasScope; } });
var requireRole_1 = require("./requireRole");
Object.defineProperty(exports, "requireRole", { enumerable: true, get: function () { return requireRole_1.requireRole; } });
__exportStar(require("./types"), exports);
