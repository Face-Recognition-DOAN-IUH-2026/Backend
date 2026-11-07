import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuth } from '../../../../shared/auth';

jest.mock('../../services/AiService', () => ({
  aiService: {
    getSummary: jest.fn(),
    listInsights: jest.fn(),
    dismissInsight: jest.fn(),
    explainInsight: jest.fn(),
    chat: jest.fn(),
    recommendBooks: jest.fn(),
  },
}));

import aiRoutes from '../../routes/ai.routes';

const JWT_SECRET = 'test-jwt-secret';

function signToken(sub: string, role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub,
      roles: [role],
      role,
      iss: 'test-issuer',
      aud: 'test-audience',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET
  );
}

describe('GET /ai/tools endpoint', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({
      jwtSecret: JWT_SECRET,
      jwtAudience: 'test-audience',
      jwtIssuer: 'test-issuer',
    });
    app = express();
    app.use(express.json());
    app.use('/ai', auth, aiRoutes);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/ai/tools');
    expect(res.status).toBe(401);
  });

  it('returns patron tools for patron role', async () => {
    const res = await request(app)
      .get('/ai/tools')
      .set('Authorization', `Bearer ${signToken('patron-1', 'patron')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const toolNames = res.body.map((t: any) => t.name);
    expect(toolNames).toContain('search_books');
    expect(toolNames).toContain('get_patron_info');
    expect(toolNames).not.toContain('get_overdue_borrows');
    expect(toolNames).not.toContain('get_schedule_today');
  });

  it('returns staff tools for staff role', async () => {
    const res = await request(app)
      .get('/ai/tools')
      .set('Authorization', `Bearer ${signToken('staff-1', 'staff')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const toolNames = res.body.map((t: any) => t.name);
    expect(toolNames).toContain('search_books');
    expect(toolNames).toContain('get_overdue_borrows');
    expect(toolNames).toContain('get_schedule_today');
    expect(toolNames).not.toContain('get_all_schedules');
  });

  it('returns admin tools for admin role (including get_all_schedules)', async () => {
    const res = await request(app)
      .get('/ai/tools')
      .set('Authorization', `Bearer ${signToken('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const toolNames = res.body.map((t: any) => t.name);
    expect(toolNames).toContain('search_books');
    expect(toolNames).toContain('get_overdue_borrows');
    expect(toolNames).toContain('get_schedule_today');
    expect(toolNames).toContain('get_all_schedules');
  });
});
