import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { createAuth } from '../../../../shared/auth';
import { sessionStore } from '../../sessions';
import sessionRouter from '../../routes/session.routes';

const JWT_SECRET = 'test-jwt-secret';

function signToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub,
      roles: ['patron'],
      iss: 'test-issuer',
      aud: 'test-audience',
      typ: 'access',
      iat: now,
      exp: now + 3600,
    },
    JWT_SECRET
  );
}

describe('GET /ai/sessions/:sessionId ownership (#11)', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({
      jwtSecret: JWT_SECRET,
      jwtAudience: 'test-audience',
      jwtIssuer: 'test-issuer',
    });
    app = express();
    app.use('/ai', auth, sessionRouter);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/ai/sessions/any');
    expect(res.status).toBe(401);
  });

  it('returns the session for its owner', async () => {
    const session = sessionStore.create('owner-1');
    const res = await request(app)
      .get(`/ai/sessions/${session.id}`)
      .set('Authorization', `Bearer ${signToken('owner-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(session.id);
    expect(res.body.patronId).toBe('owner-1');
  });

  it('returns 404 for another user session (no existence leak)', async () => {
    const session = sessionStore.create('owner-1');
    const res = await request(app)
      .get(`/ai/sessions/${session.id}`)
      .set('Authorization', `Bearer ${signToken('attacker-1')}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  it('returns 404 for a nonexistent session', async () => {
    const res = await request(app)
      .get('/ai/sessions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${signToken('owner-1')}`);
    expect(res.status).toBe(404);
  });
});
