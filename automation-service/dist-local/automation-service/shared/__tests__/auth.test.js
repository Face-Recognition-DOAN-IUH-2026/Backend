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
const jwt = __importStar(require("jsonwebtoken"));
const decodeToken_1 = require("../auth/decodeToken");
const internalAuth_1 = require("../auth/internalAuth");
const serviceToken_1 = require("../auth/serviceToken");
const TEST_SECRET = 'test-secret';
const TEST_CONFIG = {
    jwtSecret: TEST_SECRET,
    jwtAudience: 'test-audience',
    jwtIssuer: 'test-issuer',
};
describe('decodeToken', () => {
    it('should decode a valid token', () => {
        const payload = {
            sub: 'user-123',
            email: 'test@example.com',
            roles: ['admin'],
            full_name: 'Test User',
        };
        const token = jwt.sign(payload, TEST_SECRET, {
            audience: 'test-audience',
            issuer: 'test-issuer',
        });
        const result = (0, decodeToken_1.decodeToken)(token, TEST_CONFIG);
        expect(result.userId).toBe('user-123');
        expect(result.email).toBe('test@example.com');
        expect(result.role).toBe('admin');
        expect(result.fullName).toBe('Test User');
    });
    it('should throw for invalid token', () => {
        expect(() => {
            (0, decodeToken_1.decodeToken)('invalid-token', TEST_CONFIG);
        }).toThrow();
    });
});
describe('createInternalAuth', () => {
    const config = {
        serviceName: 'test-service',
        jwtSecret: TEST_SECRET,
    };
    const mockReq = (authHeader) => ({
        headers: authHeader ? { authorization: authHeader } : {},
        path: '/test',
    });
    const mockRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res;
    };
    const mockNext = jest.fn();
    beforeEach(() => {
        mockNext.mockClear();
    });
    it('should call next for valid service token', () => {
        const token = (0, serviceToken_1.generateServiceToken)('test-service', ['user:read'], TEST_SECRET);
        const middleware = (0, internalAuth_1.createInternalAuth)(config);
        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        middleware(req, res, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(req.service).toBeDefined();
    });
    it('should return 403 for invalid token', () => {
        const middleware = (0, internalAuth_1.createInternalAuth)(config);
        const req = mockReq('Bearer invalid-token');
        const res = mockRes();
        middleware(req, res, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Invalid service token',
        });
    });
    it('should return 403 for missing Authorization header', () => {
        const middleware = (0, internalAuth_1.createInternalAuth)(config);
        const req = mockReq();
        const res = mockRes();
        middleware(req, res, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Missing Authorization header',
        });
    });
    it('should return 403 for non-Bearer Authorization header', () => {
        const middleware = (0, internalAuth_1.createInternalAuth)(config);
        const req = mockReq('Basic some-token');
        const res = mockRes();
        middleware(req, res, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
