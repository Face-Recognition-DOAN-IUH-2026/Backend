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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Mock jwt.verify
jest.mock('jsonwebtoken');
describe('verifyToken', () => {
    let req;
    let res;
    let next;
    beforeEach(() => {
        req = { headers: {} };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
        process.env.JWT_SECRET = 'test-secret';
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should return 401 if no token provided', async () => {
        const { verifyToken } = await Promise.resolve().then(() => __importStar(require('../index')));
        verifyToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    });
    it('should return 401 if token is invalid', async () => {
        req.headers.authorization = 'Bearer invalid-token';
        jsonwebtoken_1.default.verify.mockImplementation(() => {
            throw new Error('Invalid token');
        });
        const { verifyToken } = await Promise.resolve().then(() => __importStar(require('../index')));
        verifyToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });
    it('should call next if token is valid', async () => {
        req.headers.authorization = 'Bearer valid-token';
        jsonwebtoken_1.default.verify.mockReturnValue({ userId: '123' });
        const { verifyToken } = await Promise.resolve().then(() => __importStar(require('../index')));
        verifyToken(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
