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

jest.mock('../../services/AccessService', () => ({
  accessService: {
    getRecent: jest.fn().mockResolvedValue([{ id: 'e1' }]),
    findKioskDevice: jest.fn().mockResolvedValue({ id: 'kiosk-1' }),
    recordKioskPresence: jest.fn().mockResolvedValue({ ok: true }),
    confirmEntry: jest.fn().mockResolvedValue({ ok: true }),
    revertPending: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

jest.mock('../../realtime/RealtimeHub', () => ({
  realtimeHub: {
    addSseClient: jest.fn((res: any) => {
      res.write('event: test\ndata: {}\n\n');
      res.end();
    }),
  },
}));

function signToken(role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: 'u1', roles: [role], iss: 'test-issuer', aud: 'test-audience', typ: 'access', exp: now + 3600, iat: now },
    'test-secret'
  );
}

describe('access-service device/PII guards (#9) and kiosk/presence error mapping (#19)', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    const accessRoutes = (await import('../../routes/access.routes')).default;
    app = express();
    app.use(express.json());
    app.use('/access', accessRoutes);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });
  });

  afterAll(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  describe('GET /access/events (SSE)', () => {
    it('returns 401 without token or internal key', async () => {
      const res = await request(app).get('/access/events');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a patron token', async () => {
      const res = await request(app)
        .get('/access/events')
        .set('Authorization', `Bearer ${signToken('patron')}`);
      expect(res.status).toBe(403);
    });

    it('allows a staff cookie/token', async () => {
      const res = await request(app)
        .get('/access/events')
        .set('Authorization', `Bearer ${signToken('staff')}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('allows X-Internal-Key without a user token', async () => {
      const res = await request(app)
        .get('/access/events')
        .set('X-Internal-Key', 'test-internal-key');
      expect(res.status).toBe(200);
    });

    it('rejects a wrong internal key', async () => {
      const res = await request(app)
        .get('/access/events')
        .set('X-Internal-Key', 'wrong-key');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /access/recent', () => {
    it('returns 401 without credentials', async () => {
      const res = await request(app).get('/access/recent');
      expect(res.status).toBe(401);
    });

    it('allows a staff token', async () => {
      const res = await request(app)
        .get('/access/recent')
        .set('Authorization', `Bearer ${signToken('staff')}`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /access/patrons/:id/confirm-entry', () => {
    it('returns 401 without credentials', async () => {
      const res = await request(app).post('/access/patrons/p1/confirm-entry');
      expect(res.status).toBe(401);
    });

    it('allows an internal key', async () => {
      const res = await request(app)
        .post('/access/patrons/p1/confirm-entry')
        .set('X-Internal-Key', 'test-internal-key');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /access/patrons/:id/revert-pending', () => {
    it('returns 401 without credentials', async () => {
      const res = await request(app).post('/access/patrons/p1/revert-pending');
      expect(res.status).toBe(401);
    });

    it('allows a staff token', async () => {
      const res = await request(app)
        .post('/access/patrons/p1/revert-pending')
        .set('Authorization', `Bearer ${signToken('staff')}`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /access/kiosk/presence unexpected errors (#19)', () => {
    it('returns 500 (not 200) when presence recording fails', async () => {
      const { accessService } = require('../../services/AccessService');
      (accessService.recordKioskPresence as jest.Mock).mockRejectedValueOnce(new Error('db down'));

      const res = await request(app)
        .post('/access/kiosk/presence')
        .set('Authorization', `Bearer ${signToken('staff')}`)
        .send({ patron_id: 'p1', student_code: 'SV001', device_id: 'kiosk-1' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.skipped).toBeUndefined();
    });
  });
});
