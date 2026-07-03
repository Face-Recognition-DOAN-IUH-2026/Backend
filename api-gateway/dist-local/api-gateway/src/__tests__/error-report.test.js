"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Mock shared modules before importing app
jest.mock('../../../shared/jira-client', () => ({
    createJiraBug: jest.fn().mockResolvedValue('https://jira.example.com/browse/TEST-1'),
    getJiraIssue: jest.fn(),
    searchJiraIssues: jest.fn(),
    getIssueTransitions: jest.fn(),
    transitionIssue: jest.fn(),
    addComment: jest.fn(),
}));
jest.mock('../../../shared/error-handler', () => ({
    errorHandler: jest.fn(),
    setupProcessErrorHandlers: jest.fn(),
}));
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
describe('Error Reporting Endpoint', () => {
    let app;
    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret';
        app = (0, express_1.default)();
        app.use(express_1.default.json({ limit: '100kb' }));
        app.post('/errors/report', index_1.verifyToken, async (req, res) => {
            const { title, description, priority, labels, service, endpoint, method, stacktrace, requestBody } = req.body;
            if (!title) {
                res.status(400).json({ error: 'title is required' });
                return;
            }
            const { createJiraBug } = require('../../../shared/jira-client');
            const issueUrl = await createJiraBug({
                title: (0, index_1.sanitizeInput)(title),
                description: (0, index_1.sanitizeInput)(description || title),
                priority: priority || 'Medium',
                labels: [...(labels || []), 'client-report'],
                service: service || 'frontend',
                endpoint,
                method,
                stacktrace,
                requestBody,
                userId: req.user?.userId || req.user?.sub,
                timestamp: new Date().toISOString(),
            });
            if (issueUrl) {
                res.json({ success: true, issueUrl });
            }
            else {
                res.json({ success: false, message: 'Jira disabled or rate limited' });
            }
        });
    });
    describe('POST /errors/report', () => {
        it('should return 401 if no token provided', async () => {
            const request = require('supertest');
            const res = await request(app)
                .post('/errors/report')
                .send({ title: 'Test error' });
            expect(res.status).toBe(401);
        });
        it('should return 400 if title is missing', async () => {
            const request = require('supertest');
            const token = jsonwebtoken_1.default.sign({ userId: '123', email: 'test@test.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
            const res = await request(app)
                .post('/errors/report')
                .set('Authorization', `Bearer ${token}`)
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 200 if request is valid', async () => {
            const request = require('supertest');
            const token = jsonwebtoken_1.default.sign({ userId: '123', email: 'test@test.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
            const res = await request(app)
                .post('/errors/report')
                .set('Authorization', `Bearer ${token}`)
                .send({ title: 'Test error', description: 'Test description' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
