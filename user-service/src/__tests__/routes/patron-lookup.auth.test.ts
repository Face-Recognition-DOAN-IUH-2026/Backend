import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

jest.mock('../../config', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtAudience: 'test-audience',
    jwtIssuer: 'test-issuer',
  },
}));

jest.mock('../../controllers', () => ({
  patronController: {
    lookup: jest.fn((_req: any, res: any) => res.json({ found: true })),
  },
}));

function signToken(role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: 'u1', roles: [role], iss: 'test-issuer', aud: 'test-audience', typ: 'access', exp: now + 3600, iat: now },
    'test-secret'
  );
}

describe('GET /patrons/lookup - auth required (#5)', () => {
  let app: express.Express;

  beforeAll(async () => {
    const patronRoutes = (await import('../../routes/patron.routes')).default;
    app = express();
    app.use('/patrons', patronRoutes);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/patrons/lookup?student_code=SV001');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a patron token', async () => {
    const res = await request(app)
      .get('/patrons/lookup?student_code=SV001')
      .set('Authorization', `Bearer ${signToken('patron')}`);
    expect(res.status).toBe(403);
  });

  it('allows a staff token through to the controller', async () => {
    const { patronController } = require('../../controllers');
    (patronController.lookup as jest.Mock).mockClear();

    const res = await request(app)
      .get('/patrons/lookup?student_code=SV001')
      .set('Authorization', `Bearer ${signToken('staff')}`);

    expect(res.status).toBe(200);
    expect(patronController.lookup).toHaveBeenCalled();
  });

  it('allows an admin token through to the controller', async () => {
    const res = await request(app)
      .get('/patrons/lookup?card_number=THV-001')
      .set('Authorization', `Bearer ${signToken('admin')}`);
    expect(res.status).toBe(200);
  });
});
