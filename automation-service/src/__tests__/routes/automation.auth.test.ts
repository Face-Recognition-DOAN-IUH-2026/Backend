import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { createAuth } from '../../../../shared/auth';
import { AppDataSource } from '../../data-source';
import automationRouter from '../../routes/automation.routes';

jest.mock('../../data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

function signToken(role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: 'u1',
      roles: [role],
      iss: 'face-recognition',
      aud: 'face-recognition-users',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    },
    'test-secret'
  );
}

describe('automation routes role guard (#17/#20)', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({
      jwtSecret: 'test-secret',
      jwtAudience: 'face-recognition-users',
      jwtIssuer: 'face-recognition',
    });
    app = express();
    app.use(express.json());
    app.use('/automation', auth, automationRouter);
  });

  beforeEach(() => {
    (AppDataSource.getRepository as jest.Mock).mockImplementation(() => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (x: any) => x),
      create: jest.fn((x: any) => x),
    }));
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/automation/tasks');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a patron token on read', async () => {
    const res = await request(app)
      .get('/automation/tasks')
      .set('Authorization', `Bearer ${signToken('patron')}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a patron token on toggle (mutation)', async () => {
    const res = await request(app)
      .put('/automation/tasks/t1/toggle')
      .set('Authorization', `Bearer ${signToken('patron')}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a patron token on manual run (mutation)', async () => {
    const res = await request(app)
      .post('/automation/tasks/t1/run')
      .set('Authorization', `Bearer ${signToken('patron')}`);
    expect(res.status).toBe(403);
  });

  it('allows a staff token', async () => {
    const res = await request(app)
      .get('/automation/tasks')
      .set('Authorization', `Bearer ${signToken('staff')}`);
    expect(res.status).toBe(200);
  });

  it('allows an admin token', async () => {
    const res = await request(app)
      .get('/automation/tasks')
      .set('Authorization', `Bearer ${signToken('admin')}`);
    expect(res.status).toBe(200);
  });
});
