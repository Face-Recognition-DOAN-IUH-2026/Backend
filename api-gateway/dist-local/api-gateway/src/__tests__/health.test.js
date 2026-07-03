"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = require("../index");
describe('Health Endpoints', () => {
    describe('GET /healthz', () => {
        it('should return 200 with status ok', async () => {
            const res = await (0, supertest_1.default)(index_1.app).get('/healthz');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.gateway).toBe('Node.js-API-Gateway');
        });
    });
    describe('GET /', () => {
        it('should return 200 with service info', async () => {
            const res = await (0, supertest_1.default)(index_1.app).get('/');
            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Face Recognition Platform API Gateway');
        });
    });
    describe('GET /api/health', () => {
        it('should return 200 with service status', async () => {
            const res = await (0, supertest_1.default)(index_1.app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.service).toBe('api-gateway');
        });
    });
});
