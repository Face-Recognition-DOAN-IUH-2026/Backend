// Critical gateway regressions from minimal-code audit (MIN-BE-1):
// 1) SSRF: catch-all must never fetch an off-origin URL derived from req.originalUrl
// 2) Route shadowing: /errors/report and /api/jira/* must be handled by their own routes
// 3) Jira routes must require a valid token

jest.mock('../../../shared/jira-client', () => ({
  createJiraBug: jest.fn(),
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

jest.mock('../config', () => ({
  config: {
    port: 3999,
    nodeEnv: 'test',
    services: {
      faceRecognitionApi: 'http://127.0.0.1:9',
      userService: 'http://127.0.0.1:9',
      borrowService: 'http://127.0.0.1:9',
      scheduleService: 'http://127.0.0.1:9',
      accessService: 'http://127.0.0.1:9',
      aiService: 'http://127.0.0.1:9',
      notificationService: 'http://127.0.0.1:9',
      automationService: 'http://127.0.0.1:9',
    },
    frontendUrl: 'http://127.0.0.1:9',
    corsOrigins: ['http://localhost:3000'],
    rateLimit: { windowMs: 60000, max: 100000 },
  },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../index';
import { createJiraBug, getJiraIssue } from '../../../shared/jira-client';

process.env.JWT_ACCESS_SECRET = 'test-secret';

const token = jwt.sign({ userId: 'u-1', role: 'staff' }, 'test-secret');

describe('Gateway critical fixes (MIN-BE-1)', () => {
  describe('SSRF protection on frontend catch-all proxy', () => {
    it('rejects protocol-relative target //evil.invalid/x with 400', async () => {
      const res = await request(app).get('//evil.invalid/x');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('rejects backslash variant /\\evil.invalid/x with 400', async () => {
      const res = await request(app).get('/\\evil.invalid/x');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('still proxies normal frontend paths (not /api)', async () => {
      // Frontend is unreachable in tests (127.0.0.1:9) -> gateway must not
      // return 404 "API route not configured" for non-/api paths: it means
      // the catch-all still handles them after being moved.
      const res = await request(app).get('/dashboard');
      expect(res.status).not.toBe(404);
    });
  });

  describe('Route shadowing: /errors/report', () => {
    it('returns 401 without token (not a proxied/404 response)', async () => {
      const res = await request(app)
        .post('/errors/report')
        .send({ title: 't', service: 'frontend' });
      expect(res.status).toBe(401);
    });

    it('reaches the handler with a valid token', async () => {
      (createJiraBug as jest.Mock).mockResolvedValue('https://jira.example.com/browse/TEST-1');
      const res = await request(app)
        .post('/errors/report')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'broken page', service: 'frontend' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.issueUrl).toBe('https://jira.example.com/browse/TEST-1');
    });
  });

  describe('Jira routes require token', () => {
    it('GET /api/jira/issue/:key returns 401 without token', async () => {
      const res = await request(app).get('/api/jira/issue/TEST-1');
      expect(res.status).toBe(401);
    });

    it('GET /api/jira/issue/:key returns issue with valid token', async () => {
      (getJiraIssue as jest.Mock).mockResolvedValue({ key: 'TEST-1', summary: 'Audit test' });
      const res = await request(app)
        .get('/api/jira/issue/TEST-1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('TEST-1');
    });

    it('GET /api/jira/search returns 401 without token', async () => {
      const res = await request(app).get('/api/jira/search?jql=project%3DTEST');
      expect(res.status).toBe(401);
    });
  });
});
