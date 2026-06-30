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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceClient = createServiceClient;
const axios_1 = __importDefault(require("axios"));
const jwt = __importStar(require("jsonwebtoken"));
const serviceScopes_1 = require("./serviceScopes");
function createServiceClient(config) {
    const { serviceName, jwtSecret, baseUrl, expiresInSeconds = 900 } = config;
    const scopes = (0, serviceScopes_1.getScopesForService)(serviceName);
    const instance = axios_1.default.create({
        baseURL: baseUrl,
        timeout: 10000,
    });
    // Add request interceptor to attach service token
    instance.interceptors.request.use((requestConfig) => {
        const now = Math.floor(Date.now() / 1000);
        const token = jwt.sign({
            sub: serviceName,
            scope: scopes,
            iat: now,
            exp: now + expiresInSeconds,
        }, jwtSecret);
        requestConfig.headers = requestConfig.headers || {};
        requestConfig.headers['Authorization'] = `Bearer ${token}`;
        return requestConfig;
    });
    return instance;
}
